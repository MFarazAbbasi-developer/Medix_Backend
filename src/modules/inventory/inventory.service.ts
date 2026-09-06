import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { FefoService, FefoAllocationResult } from './fefo.service';
import { CreateStockAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateOpeningBalanceDto } from './dto/opening-balance.dto';
import { QueryInventorySummaryDto } from './dto/query-inventory.dto';
import { QueryStockLedgerDto } from './dto/query-ledger.dto';
import {
  Prisma,
  StockMovementType,
  DocumentType,
  StockAdjustmentStatus,
} from '@prisma/client';

export interface ValidatedHierarchy {
  organizationId: string;
  branchId: string;
  warehouse: { id: string; name: string; code: string; branchId: string };
  product: { id: string; name: string; sku: string; isActive: boolean };
  batch: {
    id: string;
    batchNumber: string;
    expiryDate: Date;
    status: string;
    purchaseCost: Prisma.Decimal;
    tradePrice: Prisma.Decimal;
    retailPrice: Prisma.Decimal;
  };
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
    private readonly settingsService: SettingsService,
    private readonly fefoService: FefoService,
  ) {}

  /**
   * INVARIANT 1: Movement Type + Signed Quantity Validation.
   * IN movements MUST have quantity > 0.
   * OUT movements MUST have quantity < 0.
   */
  validateMovementSign(movementType: StockMovementType, quantity: number): void {
    if (quantity === 0) {
      throw new BadRequestException('Stock movement quantity cannot be zero');
    }

    const inMovements: StockMovementType[] = [
      StockMovementType.OPENING_BALANCE,
      StockMovementType.STOCK_ADJUSTMENT_IN,
      StockMovementType.TRANSFER_IN,
      StockMovementType.PURCHASE_RECEIPT,
      StockMovementType.SALES_RETURN,
    ];

    const outMovements: StockMovementType[] = [
      StockMovementType.STOCK_ADJUSTMENT_OUT,
      StockMovementType.TRANSFER_OUT,
      StockMovementType.PURCHASE_RETURN,
      StockMovementType.SALES_ISSUE,
    ];

    if (inMovements.includes(movementType) && quantity <= 0) {
      throw new BadRequestException(
        `Inbound movement type "${movementType}" must have a strictly positive quantity (+). Received: ${quantity}`,
      );
    }

    if (outMovements.includes(movementType) && quantity >= 0) {
      throw new BadRequestException(
        `Outbound movement type "${movementType}" must have a strictly negative quantity (-). Received: ${quantity}`,
      );
    }
  }

  /**
   * INVARIANT 2: Entity Hierarchy & Ownership Validation.
   * Validates Organization -> Branch -> Warehouse -> Product -> Batch relationship.
   */
  async validateHierarchy(
    tx: Prisma.TransactionClient,
    params: {
      organizationId: string;
      warehouseId: string;
      productId: string;
      batchId: string;
    },
  ): Promise<ValidatedHierarchy> {
    const { organizationId, warehouseId, productId, batchId } = params;

    // 1. Verify warehouse and parent branch
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, organizationId, isActive: true },
      include: { branch: true },
    });

    if (!warehouse) {
      throw new BadRequestException(
        `Active warehouse with ID "${warehouseId}" not found for organization`,
      );
    }

    if (!warehouse.branch || !warehouse.branch.isActive) {
      throw new BadRequestException(
        `Warehouse "${warehouse.name}" belongs to an inactive or non-existent branch`,
      );
    }

    // 2. Verify product
    const product = await tx.product.findFirst({
      where: { id: productId, organizationId },
    });

    if (!product) {
      throw new BadRequestException(
        `Product with ID "${productId}" not found for organization`,
      );
    }

    // 3. Verify batch belongs to product
    const batch = await tx.batch.findFirst({
      where: { id: batchId, productId },
    });

    if (!batch) {
      throw new BadRequestException(
        `Batch with ID "${batchId}" does not belong to product "${product.name}"`,
      );
    }

    return {
      organizationId,
      branchId: warehouse.branchId,
      warehouse: {
        id: warehouse.id,
        name: warehouse.name,
        code: warehouse.code,
        branchId: warehouse.branchId,
      },
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        isActive: product.isActive,
      },
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        status: batch.status,
        purchaseCost: batch.purchaseCost,
        tradePrice: batch.tradePrice,
        retailPrice: batch.retailPrice,
      },
    };
  }

  /**
   * INVARIANT 3: Mandatory Row-Level Locking Helper.
   * Acquires an explicit PostgreSQL SELECT ... FOR UPDATE row lock on the batch.
   */
  async executeWithBatchLock<T>(
    tx: Prisma.TransactionClient,
    batchId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    // Acquire PostgreSQL row lock on the batch row
    await tx.$queryRaw`SELECT "id" FROM "batches" WHERE "id" = ${batchId} FOR UPDATE;`;
    return operation();
  }

  /**
   * Calculates current physical balance for a batch in a warehouse.
   */
  async getBatchBalance(
    tx: Prisma.TransactionClient,
    warehouseId: string,
    batchId: string,
  ): Promise<number> {
    const aggregate = await tx.stockMovement.aggregate({
      where: { warehouseId, batchId },
      _sum: { quantity: true },
    });

    return aggregate._sum.quantity || 0;
  }

  /**
   * FEFO Allocation Preview / Execution.
   */
  async previewFefoAllocation(params: {
    warehouseId: string;
    productId: string;
    quantity: number;
  }): Promise<FefoAllocationResult> {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id: params.warehouseId },
    });

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID "${params.warehouseId}" not found`);
    }

    return this.fefoService.allocate({
      organizationId: org.id,
      branchId: warehouse.branchId,
      warehouseId: warehouse.id,
      productId: params.productId,
      requestedQuantity: params.quantity,
    });
  }

  /**
   * Creates an Initial / Opening Stock Balance for a batch.
   */
  async createOpeningBalance(dto: CreateOpeningBalanceDto, userId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    return this.prisma.$transaction(async (tx) => {
      const hierarchy = await this.validateHierarchy(tx, {
        organizationId: org.id,
        warehouseId: dto.warehouseId,
        productId: dto.productId,
        batchId: dto.batchId,
      });

      return this.executeWithBatchLock(tx, dto.batchId, async () => {
        const unitCost = dto.unitCost !== undefined ? dto.unitCost : Number(hierarchy.batch.purchaseCost);

        this.validateMovementSign(StockMovementType.OPENING_BALANCE, dto.quantity);

        const movement = await tx.stockMovement.create({
          data: {
            organizationId: org.id,
            branchId: hierarchy.branchId,
            warehouseId: dto.warehouseId,
            productId: dto.productId,
            batchId: dto.batchId,
            movementType: StockMovementType.OPENING_BALANCE,
            quantity: dto.quantity,
            unitCost,
            referenceType: 'OPENING_BALANCE',
            notes: dto.notes || 'Initial stock balance setup',
            createdByUserId: userId,
          },
        });

        await this.auditService.log({
          userId,
          action: 'CREATE_OPENING_BALANCE',
          entity: 'STOCK_MOVEMENT',
          entityId: movement.id,
          details: {
            product: hierarchy.product.sku,
            batch: hierarchy.batch.batchNumber,
            quantity: dto.quantity,
            warehouse: hierarchy.warehouse.name,
          },
        });

        return movement;
      });
    });
  }

  /**
   * Retrieves paginated stock summary grouped by product.
   */
  async getInventorySummary(params: QueryInventorySummaryDto) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const page = params.page || 1;
    const limit = params.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      organizationId: org.id,
    };

    if (params.search) {
      const s = params.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { genericName: { contains: s, mode: 'insensitive' } },
        { sku: { contains: s, mode: 'insensitive' } },
        { barcode: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (params.categoryId) where.categoryId = params.categoryId;
    if (params.manufacturerId) where.manufacturerId = params.manufacturerId;

    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          manufacturer: { select: { id: true, name: true, code: true } },
          category: { select: { id: true, name: true } },
          unit: { select: { id: true, name: true, symbol: true } },
          batches: {
            include: {
              stockMovements: {
                where: params.warehouseId ? { warehouseId: params.warehouseId } : undefined,
                select: {
                  warehouseId: true,
                  quantity: true,
                  unitCost: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const now = new Date();

    const items = products.map((prod) => {
      let physicalStock = 0;
      let saleableStock = 0;
      let quarantinedStock = 0;
      let recalledStock = 0;
      let expiredStock = 0;
      let totalCostValuation = 0;
      let totalTradeValuation = 0;

      for (const batch of prod.batches) {
        const batchQty = batch.stockMovements.reduce((sum, m) => sum + m.quantity, 0);

        if (batchQty !== 0) {
          physicalStock += batchQty;
          totalCostValuation += batchQty * Number(batch.purchaseCost);
          totalTradeValuation += batchQty * Number(batch.tradePrice);

          if (batch.status === 'QUARANTINED') {
            quarantinedStock += batchQty;
          } else if (batch.status === 'RECALLED') {
            recalledStock += batchQty;
          } else if (new Date(batch.expiryDate) <= now) {
            expiredStock += batchQty;
          } else if (batch.status === 'ACTIVE') {
            saleableStock += batchQty;
          }
        }
      }

      return {
        id: prod.id,
        sku: prod.sku,
        name: prod.name,
        genericName: prod.genericName,
        dosageForm: prod.dosageForm,
        strength: prod.strength,
        packSize: prod.packSize,
        unit: prod.unit,
        category: prod.category,
        manufacturer: prod.manufacturer,
        isActive: prod.isActive,
        physicalStock,
        saleableStock,
        quarantinedStock,
        recalledStock,
        expiredStock,
        totalCostValuation,
        totalTradeValuation,
        batchCount: prod.batches.length,
      };
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves batch-level and warehouse-level stock details for a single product.
   */
  async getProductStockDetails(productId: string, warehouseId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const product = await this.prisma.product.findFirst({
      where: { id: productId, organizationId: org.id },
      include: {
        manufacturer: true,
        category: true,
        unit: true,
        batches: {
          orderBy: { expiryDate: 'asc' },
          include: {
            stockMovements: {
              where: warehouseId ? { warehouseId } : undefined,
              include: {
                warehouse: {
                  select: { id: true, name: true, code: true, warehouseType: true },
                },
              },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found`);
    }

    const now = new Date();

    const batchBreakdown = product.batches.map((batch) => {
      // Calculate per-warehouse distribution
      const warehouseMap: Record<string, { warehouse: any; quantity: number }> = {};

      for (const m of batch.stockMovements) {
        if (!warehouseMap[m.warehouseId]) {
          warehouseMap[m.warehouseId] = {
            warehouse: m.warehouse,
            quantity: 0,
          };
        }
        warehouseMap[m.warehouseId].quantity += m.quantity;
      }

      const totalQuantity = batch.stockMovements.reduce((sum, m) => sum + m.quantity, 0);
      const saleableQuantity = batch.stockMovements
        .filter((m) => m.warehouse?.warehouseType === 'STANDARD')
        .reduce((sum, m) => sum + m.quantity, 0);
      const quarantineQuantity = batch.stockMovements
        .filter((m) => m.warehouse?.warehouseType === 'QUARANTINE')
        .reduce((sum, m) => sum + m.quantity, 0);

      const isExpired = new Date(batch.expiryDate) <= now;
      const isSaleable = batch.status === 'ACTIVE' && !isExpired && saleableQuantity > 0;

      return {
        id: batch.id,
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expiryDate: batch.expiryDate,
        status: batch.status,
        purchaseCost: Number(batch.purchaseCost),
        tradePrice: Number(batch.tradePrice),
        retailPrice: Number(batch.retailPrice),
        remarks: batch.remarks,
        totalQuantity,
        saleableQuantity,
        quarantineQuantity,
        isExpired,
        isSaleable,
        warehouses: Object.values(warehouseMap),
      };
    });

    return {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        genericName: product.genericName,
        dosageForm: product.dosageForm,
        strength: product.strength,
        packSize: product.packSize,
        unit: product.unit,
        manufacturer: product.manufacturer,
        category: product.category,
      },
      batches: batchBreakdown,
    };
  }

  /**
   * Retrieves paginated chronological stock ledger movements.
   */
  async getStockLedger(params: QueryStockLedgerDto) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const page = params.page || 1;
    const limit = params.limit || 30;
    const skip = (page - 1) * limit;

    const where: Prisma.StockMovementWhereInput = {
      organizationId: org.id,
    };

    if (params.productId) where.productId = params.productId;
    if (params.batchId) where.batchId = params.batchId;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.movementType) where.movementType = params.movementType;

    if (params.startDate || params.endDate) {
      where.movementDate = {};
      if (params.startDate) where.movementDate.gte = new Date(params.startDate);
      if (params.endDate) where.movementDate.lte = new Date(params.endDate);
    }

    const [total, items] = await Promise.all([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ movementDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          product: { select: { id: true, name: true, sku: true, genericName: true } },
          batch: { select: { id: true, batchNumber: true, expiryDate: true, status: true } },
          createdByUser: { select: { id: true, username: true, displayName: true } },
        },
      }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Creates a draft Stock Adjustment document.
   */
  async createStockAdjustment(dto: CreateStockAdjustmentDto, userId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.warehouseId, organizationId: org.id, isActive: true },
    });

    if (!warehouse) {
      throw new BadRequestException(`Warehouse with ID "${dto.warehouseId}" not found`);
    }

    // Verify all items belong to organization
    for (const item of dto.items) {
      if (item.varianceQuantity === 0) {
        throw new BadRequestException('Adjustment item variance quantity cannot be 0');
      }

      await this.validateHierarchy(this.prisma, {
        organizationId: org.id,
        warehouseId: dto.warehouseId,
        productId: item.productId,
        batchId: item.batchId,
      });
    }

    // Draft adjustment placeholder number until posted
    const draftNumber = `DRAFT-${Date.now().toString().slice(-6)}`;

    const adjustment = await this.prisma.stockAdjustment.create({
      data: {
        organizationId: org.id,
        branchId: warehouse.branchId,
        warehouseId: dto.warehouseId,
        adjustmentNumber: draftNumber,
        reason: dto.reason,
        status: StockAdjustmentStatus.DRAFT,
        notes: dto.notes,
        items: {
          create: await Promise.all(
            dto.items.map(async (item) => {
              const batch = await this.prisma.batch.findUniqueOrThrow({ where: { id: item.batchId } });
              return {
                productId: item.productId,
                batchId: item.batchId,
                quantity: item.varianceQuantity,
                unitCost: batch.purchaseCost,
                remarks: item.remarks,
              };
            }),
          ),
        },
      },
      include: {
        warehouse: true,
        items: {
          include: {
            product: true,
            batch: true,
          },
        },
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_STOCK_ADJUSTMENT_DRAFT',
      entity: 'STOCK_ADJUSTMENT',
      entityId: adjustment.id,
      details: { reason: dto.reason, itemCount: dto.items.length },
    });

    return adjustment;
  }

  /**
   * Retrieves stock adjustment documents.
   */
  async getStockAdjustments(
    warehouseId?: string,
    status?: StockAdjustmentStatus,
    page = 1,
    limit = 20,
  ) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const skip = (page - 1) * limit;
    const where: Prisma.StockAdjustmentWhereInput = {
      organizationId: org.id,
    };

    if (warehouseId) where.warehouseId = warehouseId;
    if (status) where.status = status;

    const [total, items] = await Promise.all([
      this.prisma.stockAdjustment.count({ where }),
      this.prisma.stockAdjustment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          warehouse: { select: { id: true, name: true, code: true } },
          postedByUser: { select: { id: true, username: true, displayName: true } },
          items: {
            include: {
              product: { select: { id: true, name: true, sku: true } },
              batch: { select: { id: true, batchNumber: true, expiryDate: true } },
            },
          },
        },
      }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Posts and commits a Stock Adjustment to the immutable StockMovement ledger.
   */
  async postStockAdjustment(id: string, userId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const allowNegativeSetting = await this.settingsService.getSetting('allowNegativeStock');
    const allowNegative = allowNegativeSetting === 'true';

    return this.prisma.$transaction(async (tx) => {
      const adjustment = await tx.stockAdjustment.findUnique({
        where: { id },
        include: {
          items: {
            include: { batch: true, product: true },
          },
        },
      });

      if (!adjustment) {
        throw new NotFoundException(`Stock adjustment with ID "${id}" not found`);
      }

      if (adjustment.status !== StockAdjustmentStatus.DRAFT) {
        throw new BadRequestException(
          `Only DRAFT adjustments can be posted. Current status: ${adjustment.status}`,
        );
      }

      // 1. Generate permanent sequential document number atomically
      const { documentNumber } = await this.numberingService.generateNextNumber(
        DocumentType.STOCK_ADJUSTMENT,
        adjustment.branchId,
      );

      // 2. Lock each batch, validate balance, and generate stock movements
      for (const item of adjustment.items) {
        await this.executeWithBatchLock(tx, item.batchId, async () => {
          const currentBalance = await this.getBatchBalance(
            tx,
            adjustment.warehouseId,
            item.batchId,
          );

          const variance = item.quantity;
          const newBalance = currentBalance + variance;

          if (!allowNegative && newBalance < 0) {
            throw new BadRequestException(
              `Adjustment rejected: Batch "${item.batch.batchNumber}" has balance ${currentBalance}. Decrement of ${Math.abs(
                variance,
              )} would result in negative stock (${newBalance}).`,
            );
          }

          const movementType =
            variance > 0
              ? StockMovementType.STOCK_ADJUSTMENT_IN
              : StockMovementType.STOCK_ADJUSTMENT_OUT;

          this.validateMovementSign(movementType, variance);

          await tx.stockMovement.create({
            data: {
              organizationId: org.id,
              branchId: adjustment.branchId,
              warehouseId: adjustment.warehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType,
              quantity: variance, // Signed (+ or -)
              unitCost: item.unitCost,
              referenceType: 'STOCK_ADJUSTMENT',
              referenceId: adjustment.id,
              notes: item.remarks || `Stock adjustment (${adjustment.reason}) - ${documentNumber}`,
              createdByUserId: userId,
            },
          });
        });
      }

      // 3. Mark adjustment as POSTED
      const updated = await tx.stockAdjustment.update({
        where: { id },
        data: {
          adjustmentNumber: documentNumber,
          status: StockAdjustmentStatus.POSTED,
          postedAt: new Date(),
          postedByUserId: userId,
        },
        include: {
          warehouse: true,
          items: {
            include: { product: true, batch: true },
          },
        },
      });

      await this.auditService.log({
        userId,
        action: 'POST_STOCK_ADJUSTMENT',
        entity: 'STOCK_ADJUSTMENT',
        entityId: adjustment.id,
        details: {
          documentNumber,
          itemCount: adjustment.items.length,
          warehouseId: adjustment.warehouseId,
        },
      });

      return updated;
    });
  }

  /**
   * Reversal / Correction Strategy:
   * Generates a compensating adjustment and inverse movements.
   */
  async reverseStockAdjustment(id: string, userId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) throw new NotFoundException('Organization profile not found');

    const allowNegativeSetting = await this.settingsService.getSetting('allowNegativeStock');
    const allowNegative = allowNegativeSetting === 'true';

    return this.prisma.$transaction(async (tx) => {
      const original = await tx.stockAdjustment.findUnique({
        where: { id },
        include: {
          items: {
            include: { batch: true, product: true },
          },
        },
      });

      if (!original) {
        throw new NotFoundException(`Stock adjustment with ID "${id}" not found`);
      }

      if (original.status !== StockAdjustmentStatus.POSTED) {
        throw new BadRequestException('Only POSTED stock adjustments can be reversed');
      }

      // 1. Generate document number for reversal
      const { documentNumber } = await this.numberingService.generateNextNumber(
        DocumentType.STOCK_ADJUSTMENT,
        original.branchId,
      );

      // 2. Create reversal adjustment record
      const reversalAdjustment = await tx.stockAdjustment.create({
        data: {
          organizationId: org.id,
          branchId: original.branchId,
          warehouseId: original.warehouseId,
          adjustmentNumber: documentNumber,
          reason: 'CORRECTION',
          status: StockAdjustmentStatus.POSTED,
          notes: `Reversal of adjustment "${original.adjustmentNumber}" (ID: ${original.id})`,
          postedAt: new Date(),
          postedByUserId: userId,
          items: {
            create: original.items.map((item) => ({
              productId: item.productId,
              batchId: item.batchId,
              quantity: -item.quantity, // Inverse variance
              unitCost: item.unitCost,
              remarks: `Reversal of line ${item.id}`,
            })),
          },
        },
      });

      // 3. Post compensating movements with batch locking
      for (const item of original.items) {
        const inverseQuantity = -item.quantity;

        await this.executeWithBatchLock(tx, item.batchId, async () => {
          const currentBalance = await this.getBatchBalance(
            tx,
            original.warehouseId,
            item.batchId,
          );

          const newBalance = currentBalance + inverseQuantity;

          if (!allowNegative && newBalance < 0) {
            throw new BadRequestException(
              `Reversal rejected: Batch "${item.batch.batchNumber}" has balance ${currentBalance}. Decrement of ${Math.abs(
                inverseQuantity,
              )} would result in negative stock (${newBalance}).`,
            );
          }

          const movementType =
            inverseQuantity > 0
              ? StockMovementType.STOCK_ADJUSTMENT_IN
              : StockMovementType.STOCK_ADJUSTMENT_OUT;

          this.validateMovementSign(movementType, inverseQuantity);

          await tx.stockMovement.create({
            data: {
              organizationId: org.id,
              branchId: original.branchId,
              warehouseId: original.warehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType,
              quantity: inverseQuantity,
              unitCost: item.unitCost,
              referenceType: 'ADJUSTMENT_REVERSAL',
              referenceId: reversalAdjustment.id,
              notes: `Compensating reversal for ${original.adjustmentNumber}`,
              createdByUserId: userId,
            },
          });
        });
      }

      // Mark original adjustment as CANCELLED
      await tx.stockAdjustment.update({
        where: { id: original.id },
        data: {
          status: StockAdjustmentStatus.CANCELLED,
          notes: `${original.notes ? original.notes + ' | ' : ''}Reversed by ${documentNumber}`,
        },
      });

      await this.auditService.log({
        userId,
        action: 'REVERSE_STOCK_ADJUSTMENT',
        entity: 'STOCK_ADJUSTMENT',
        entityId: original.id,
        details: {
          originalDocumentNumber: original.adjustmentNumber,
          reversalDocumentNumber: documentNumber,
        },
      });

      return reversalAdjustment;
    });
  }
}
