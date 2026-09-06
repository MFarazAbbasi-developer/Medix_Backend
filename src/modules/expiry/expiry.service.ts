import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  DocumentType,
  BatchStatus,
  RecallStatus,
  StockMovementType,
  Prisma,
} from '@prisma/client';
import {
  QueryExpiryDto,
  QueryExpiryMetricsDto,
  ExpiryFilterStatus,
} from './dto/query-expiry.dto';
import {
  QuarantineMoveDto,
  QuarantineReleaseDto,
} from './dto/quarantine-move.dto';
import { CreateRecallDto } from './dto/create-recall.dto';
import { UpdateRecallStatusDto } from './dto/update-recall-status.dto';
import { QueryRecallDto } from './dto/query-recall.dto';

@Injectable()
export class ExpiryService {
  private readonly logger = new Logger(ExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organization not found in system');
    }
    return org.id;
  }

  // ==========================================
  // 1. EXPIRY MANAGEMENT & AGING METRICS
  // ==========================================

  /**
   * Calculates comprehensive expiry metrics, threshold buckets, and warehouse valuations.
   * Expiry is strictly derived dynamically from expiryDate < current date.
   */
  async getExpiryMetrics(dto: QueryExpiryMetricsDto) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    // Configurable thresholds (default: 30, 60, 90, 180 days)
    const thresholdList: number[] = dto.thresholds
      ? dto.thresholds
          .split(',')
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !isNaN(n) && n > 0)
      : [30, 60, 90, 180];

    // Find all batches with product info and stock movements
    const batches = await this.prisma.batch.findMany({
      where: {
        product: { organizationId: orgId },
      },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            manufacturer: { select: { id: true, name: true } },
          },
        },
        stockMovements: {
          where: {
            organizationId: orgId,
            ...(dto.branchId ? { branchId: dto.branchId } : {}),
          },
          include: {
            warehouse: {
              select: {
                id: true,
                name: true,
                code: true,
                warehouseType: true,
              },
            },
          },
        },
      },
    });

    let totalExpiredBatches = 0;
    let totalExpiredQuantity = 0;
    let totalExpiredValuation = 0;

    let standardStockQuantity = 0;
    let standardStockValuation = 0;
    let quarantineStockQuantity = 0;
    let quarantineStockValuation = 0;

    const thresholdMetrics = thresholdList.map((days) => ({
      thresholdDays: days,
      batchCount: 0,
      totalQuantity: 0,
      totalValuation: 0,
    }));

    for (const b of batches) {
      const purchaseCost = Number(b.purchaseCost);

      // Aggregate warehouse stock
      let batchTotalQty = 0;
      let batchStandardQty = 0;
      let batchQuarantineQty = 0;

      for (const m of b.stockMovements) {
        batchTotalQty += m.quantity;
        if (m.warehouse.warehouseType === 'STANDARD') {
          batchStandardQty += m.quantity;
        } else if (m.warehouse.warehouseType === 'QUARANTINE') {
          batchQuarantineQty += m.quantity;
        }
      }

      if (batchTotalQty <= 0) {
        continue; // No physical stock exists for this batch
      }

      // Warehouse stock overall
      standardStockQuantity += Math.max(0, batchStandardQty);
      standardStockValuation += Math.max(0, batchStandardQty) * purchaseCost;
      quarantineStockQuantity += Math.max(0, batchQuarantineQty);
      quarantineStockValuation += Math.max(0, batchQuarantineQty) * purchaseCost;

      const expiryDate = new Date(b.expiryDate);
      const isExpired = expiryDate <= now;
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (isExpired) {
        totalExpiredBatches++;
        totalExpiredQuantity += batchTotalQty;
        totalExpiredValuation += batchTotalQty * purchaseCost;
      } else {
        // Check threshold buckets
        for (const tm of thresholdMetrics) {
          if (daysUntilExpiry <= tm.thresholdDays) {
            tm.batchCount++;
            tm.totalQuantity += batchTotalQty;
            tm.totalValuation += batchTotalQty * purchaseCost;
          }
        }
      }
    }

    return {
      asOfDate: now.toISOString(),
      expired: {
        batchCount: totalExpiredBatches,
        totalQuantity: totalExpiredQuantity,
        totalValuation: Number(totalExpiredValuation.toFixed(2)),
      },
      thresholds: thresholdMetrics.map((tm) => ({
        thresholdDays: tm.thresholdDays,
        batchCount: tm.batchCount,
        totalQuantity: tm.totalQuantity,
        totalValuation: Number(tm.totalValuation.toFixed(2)),
      })),
      warehouseBreakdown: {
        standard: {
          quantity: standardStockQuantity,
          valuation: Number(standardStockValuation.toFixed(2)),
        },
        quarantine: {
          quantity: quarantineStockQuantity,
          valuation: Number(quarantineStockValuation.toFixed(2)),
        },
      },
    };
  }

  /**
   * Retrieves expiring and expired batches with configurable filters and pagination.
   */
  async getExpiringBatches(dto: QueryExpiryDto) {
    const orgId = await this.getOrganizationId();
    const now = new Date();
    const thresholdDays = dto.thresholdDays || 90;
    const thresholdDate = new Date(
      now.getTime() + thresholdDays * 24 * 60 * 60 * 1000,
    );

    const where: Prisma.BatchWhereInput = {
      product: {
        organizationId: orgId,
        ...(dto.productId ? { id: dto.productId } : {}),
        ...(dto.manufacturerId ? { manufacturerId: dto.manufacturerId } : {}),
      },
      ...(dto.batchNumber
        ? { batchNumber: { contains: dto.batchNumber, mode: 'insensitive' } }
        : {}),
    };

    if (dto.search) {
      where.OR = [
        { batchNumber: { contains: dto.search, mode: 'insensitive' } },
        { product: { name: { contains: dto.search, mode: 'insensitive' } } },
        { product: { sku: { contains: dto.search, mode: 'insensitive' } } },
        {
          product: {
            genericName: { contains: dto.search, mode: 'insensitive' },
          },
        },
      ];
    }

    // Expiry status filter
    if (dto.status === ExpiryFilterStatus.EXPIRED) {
      where.expiryDate = { lte: now };
    } else if (dto.status === ExpiryFilterStatus.EXPIRING_SOON) {
      where.expiryDate = { gt: now, lte: thresholdDate };
    } else if (
      dto.status === ExpiryFilterStatus.ALL_AFFECTED ||
      !dto.status
    ) {
      where.expiryDate = { lte: thresholdDate };
    }

    // Fetch batches matching criteria
    const batches = await this.prisma.batch.findMany({
      where,
      include: {
        product: {
          include: {
            manufacturer: true,
            unit: true,
          },
        },
        stockMovements: {
          where: {
            organizationId: orgId,
            ...(dto.branchId ? { branchId: dto.branchId } : {}),
            ...(dto.warehouseId ? { warehouseId: dto.warehouseId } : {}),
          },
          include: {
            warehouse: {
              select: {
                id: true,
                name: true,
                code: true,
                warehouseType: true,
              },
            },
          },
        },
      },
      orderBy: [
        {
          [dto.sortBy || 'expiryDate']: dto.sortOrder || 'asc',
        },
      ],
    });

    // Process physical balances per batch and warehouse
    const resultList: any[] = [];

    for (const b of batches) {
      const warehouseMap = new Map<
        string,
        {
          warehouseId: string;
          warehouseName: string;
          warehouseCode: string;
          warehouseType: string;
          quantity: number;
        }
      >();

      let totalQuantity = 0;
      let standardQuantity = 0;
      let quarantineQuantity = 0;

      for (const m of b.stockMovements) {
        const whId = m.warehouseId;
        const current = warehouseMap.get(whId) || {
          warehouseId: whId,
          warehouseName: m.warehouse.name,
          warehouseCode: m.warehouse.code,
          warehouseType: m.warehouse.warehouseType,
          quantity: 0,
        };
        current.quantity += m.quantity;
        warehouseMap.set(whId, current);

        totalQuantity += m.quantity;
        if (m.warehouse.warehouseType === 'STANDARD') {
          standardQuantity += m.quantity;
        } else if (m.warehouse.warehouseType === 'QUARANTINE') {
          quarantineQuantity += m.quantity;
        }
      }

      // If warehouse filter was passed and that warehouse has <= 0, skip
      if (dto.warehouseId && (warehouseMap.get(dto.warehouseId)?.quantity || 0) <= 0) {
        continue;
      }

      // If no physical stock exists at all across branches, skip
      if (totalQuantity <= 0) {
        continue;
      }

      const expiryDate = new Date(b.expiryDate);
      const isExpired = expiryDate <= now;
      const daysToExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const purchaseCost = Number(b.purchaseCost);
      const retailPrice = Number(b.retailPrice);
      const tradePrice = Number(b.tradePrice);

      resultList.push({
        id: b.id,
        batchNumber: b.batchNumber,
        mfgDate: b.mfgDate,
        expiryDate: b.expiryDate,
        daysToExpiry,
        isExpired,
        status: b.status,
        purchaseCost,
        tradePrice,
        retailPrice,
        totalQuantity,
        standardQuantity: Math.max(0, standardQuantity),
        quarantineQuantity: Math.max(0, quarantineQuantity),
        totalValuation: Number((totalQuantity * purchaseCost).toFixed(2)),
        retailValuation: Number((totalQuantity * retailPrice).toFixed(2)),
        product: {
          id: b.product.id,
          sku: b.product.sku,
          name: b.product.name,
          genericName: b.product.genericName,
          dosageForm: b.product.dosageForm,
          strength: b.product.strength,
          packSize: b.product.packSize,
          manufacturer: b.product.manufacturer
            ? {
                id: b.product.manufacturer.id,
                name: b.product.manufacturer.name,
              }
            : null,
          unit: b.product.unit ? b.product.unit.symbol : null,
        },
        warehouses: Array.from(warehouseMap.values()).filter((w) => w.quantity > 0),
      });
    }

    // Apply manual pagination on filtered aggregate list
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const totalItems = resultList.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const paginatedItems = resultList.slice((page - 1) * limit, page * limit);

    return {
      data: paginatedItems,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  /**
   * Retrieves physical stock breakdown for a specific batch across all warehouses.
   */
  async getBatchStockBreakdown(batchId: string, branchId?: string) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const batch = await this.prisma.batch.findFirst({
      where: {
        id: batchId,
        product: { organizationId: orgId },
      },
      include: {
        product: {
          include: {
            manufacturer: true,
            unit: true,
          },
        },
        productRecalls: {
          where: {
            status: { in: [RecallStatus.OPEN, RecallStatus.IN_PROGRESS] },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID "${batchId}" not found`);
    }

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        batchId,
        ...(branchId ? { branchId } : {}),
      },
      include: {
        warehouse: true,
      },
    });

    const warehouseMap = new Map<
      string,
      {
        warehouseId: string;
        warehouseName: string;
        warehouseCode: string;
        warehouseType: string;
        branchId: string;
        quantity: number;
      }
    >();

    let totalQuantity = 0;
    let standardQuantity = 0;
    let quarantineQuantity = 0;

    for (const m of movements) {
      const whId = m.warehouseId;
      const current = warehouseMap.get(whId) || {
        warehouseId: whId,
        warehouseName: m.warehouse.name,
        warehouseCode: m.warehouse.code,
        warehouseType: m.warehouse.warehouseType,
        branchId: m.branchId,
        quantity: 0,
      };
      current.quantity += m.quantity;
      warehouseMap.set(whId, current);

      totalQuantity += m.quantity;
      if (m.warehouse.warehouseType === 'STANDARD') {
        standardQuantity += m.quantity;
      } else if (m.warehouse.warehouseType === 'QUARANTINE') {
        quarantineQuantity += m.quantity;
      }
    }

    const expiryDate = new Date(batch.expiryDate);
    const isExpired = expiryDate <= now;
    const daysToExpiry = Math.ceil(
      (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    return {
      batch: {
        id: batch.id,
        batchNumber: batch.batchNumber,
        mfgDate: batch.mfgDate,
        expiryDate: batch.expiryDate,
        daysToExpiry,
        isExpired,
        status: batch.status,
        purchaseCost: Number(batch.purchaseCost),
        tradePrice: Number(batch.tradePrice),
        retailPrice: Number(batch.retailPrice),
        activeRecallsCount: batch.productRecalls.length,
      },
      product: {
        id: batch.product.id,
        sku: batch.product.sku,
        name: batch.product.name,
        genericName: batch.product.genericName,
        manufacturer: batch.product.manufacturer?.name || null,
        unit: batch.product.unit?.symbol || null,
      },
      stock: {
        totalQuantity,
        standardQuantity: Math.max(0, standardQuantity),
        quarantineQuantity: Math.max(0, quarantineQuantity),
        valuation: Number((totalQuantity * Number(batch.purchaseCost)).toFixed(2)),
      },
      warehouses: Array.from(warehouseMap.values()),
    };
  }

  // ==========================================
  // 2. QUARANTINE OPERATIONS
  // ==========================================

  /**
   * Explicit workflow: STANDARD -> QUARANTINE.
   * Atomically transfers physical stock from standard saleable inventory into quarantine.
   */
  async moveStockToQuarantine(dto: QuarantineMoveDto, userId?: string) {
    const orgId = await this.getOrganizationId();

    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    if (dto.quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    const [sourceWarehouse, destWarehouse, batch] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: dto.sourceWarehouseId, organizationId: orgId },
      }),
      this.prisma.warehouse.findFirst({
        where: { id: dto.destinationWarehouseId, organizationId: orgId },
      }),
      this.prisma.batch.findFirst({
        where: { id: dto.batchId, product: { organizationId: orgId } },
        include: { product: true },
      }),
    ]);

    if (!sourceWarehouse) {
      throw new NotFoundException('Source warehouse not found');
    }
    if (!destWarehouse) {
      throw new NotFoundException('Destination warehouse not found');
    }
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    if (sourceWarehouse.warehouseType !== 'STANDARD') {
      throw new BadRequestException(
        `Source warehouse "${sourceWarehouse.name}" must be a STANDARD warehouse for quarantine movement`,
      );
    }
    if (destWarehouse.warehouseType !== 'QUARANTINE') {
      throw new BadRequestException(
        `Destination warehouse "${destWarehouse.name}" must be a QUARANTINE warehouse`,
      );
    }

    const branchId = sourceWarehouse.branchId;

    // Execute atomic transaction with deterministic row lock on batch
    const result = await this.prisma.$transaction(async (tx) => {
      // Row lock on batch
      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ${batch.id}
        FOR UPDATE
      `;

      // Check available stock in source standard warehouse
      const sourceMovements = await tx.stockMovement.findMany({
        where: {
          organizationId: orgId,
          warehouseId: sourceWarehouse.id,
          batchId: batch.id,
        },
        select: { quantity: true },
      });

      const physicalAvailable = sourceMovements.reduce((sum, m) => sum + m.quantity, 0);

      if (physicalAvailable < dto.quantity) {
        throw new BadRequestException(
          `Insufficient stock for batch "${batch.batchNumber}" in warehouse "${sourceWarehouse.name}". Available: ${physicalAvailable}, Requested: ${dto.quantity}`,
        );
      }

      const movementDate = new Date();

      // 1. Create TRANSFER_OUT from source STANDARD warehouse
      const outMovement = await tx.stockMovement.create({
        data: {
          organizationId: orgId,
          branchId,
          warehouseId: sourceWarehouse.id,
          productId: batch.productId,
          batchId: batch.id,
          movementType: StockMovementType.TRANSFER_OUT,
          quantity: -dto.quantity,
          unitCost: batch.purchaseCost,
          referenceType: 'QUARANTINE_MOVE',
          referenceId: batch.id,
          movementDate,
          notes: `Quarantine In: ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
          createdByUserId: userId || null,
        },
      });

      // 2. Create TRANSFER_IN to destination QUARANTINE warehouse
      const inMovement = await tx.stockMovement.create({
        data: {
          organizationId: orgId,
          branchId: destWarehouse.branchId,
          warehouseId: destWarehouse.id,
          productId: batch.productId,
          batchId: batch.id,
          movementType: StockMovementType.TRANSFER_IN,
          quantity: dto.quantity,
          unitCost: batch.purchaseCost,
          referenceType: 'QUARANTINE_MOVE',
          referenceId: batch.id,
          movementDate,
          notes: `Quarantined from ${sourceWarehouse.name}: ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
          createdByUserId: userId || null,
        },
      });

      return { outMovement, inMovement };
    });

    // Audit log
    await this.auditService.log({
      userId,
      action: 'QUARANTINE_STOCK_MOVE',
      entity: 'BATCH',
      entityId: batch.id,
      details: {
        batchNumber: batch.batchNumber,
        productName: batch.product.name,
        quantity: dto.quantity,
        sourceWarehouseId: sourceWarehouse.id,
        sourceWarehouseName: sourceWarehouse.name,
        destWarehouseId: destWarehouse.id,
        destWarehouseName: destWarehouse.name,
        reason: dto.reason,
        notes: dto.notes,
      },
    });

    return {
      success: true,
      message: `Successfully quarantined ${dto.quantity} units of batch ${batch.batchNumber} to ${destWarehouse.name}`,
      data: result,
    };
  }

  /**
   * Explicit workflow: QUARANTINE -> STANDARD (Release to Saleable Stock).
   * Validates that batch is ACTIVE, not RECALLED, and not expired before releasing.
   */
  async releaseQuarantineStock(dto: QuarantineReleaseDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    if (dto.quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    const [sourceWarehouse, destWarehouse, batch] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: dto.sourceWarehouseId, organizationId: orgId },
      }),
      this.prisma.warehouse.findFirst({
        where: { id: dto.destinationWarehouseId, organizationId: orgId },
      }),
      this.prisma.batch.findFirst({
        where: { id: dto.batchId, product: { organizationId: orgId } },
        include: { product: true },
      }),
    ]);

    if (!sourceWarehouse) {
      throw new NotFoundException('Source warehouse not found');
    }
    if (!destWarehouse) {
      throw new NotFoundException('Destination warehouse not found');
    }
    if (!batch) {
      throw new NotFoundException('Batch not found');
    }

    if (sourceWarehouse.warehouseType !== 'QUARANTINE') {
      throw new BadRequestException(
        `Source warehouse "${sourceWarehouse.name}" must be a QUARANTINE warehouse for stock release`,
      );
    }
    if (destWarehouse.warehouseType !== 'STANDARD') {
      throw new BadRequestException(
        `Destination warehouse "${destWarehouse.name}" must be a STANDARD saleable warehouse`,
      );
    }

    // Critical validation: Expired or Recalled stock can NEVER be released back to STANDARD
    if (batch.status === BatchStatus.RECALLED) {
      throw new BadRequestException(
        `Cannot release batch "${batch.batchNumber}" because it is currently under RECALL`,
      );
    }

    if (new Date(batch.expiryDate) <= now) {
      throw new BadRequestException(
        `Cannot release batch "${batch.batchNumber}" because it has expired on ${new Date(batch.expiryDate).toLocaleDateString()}`,
      );
    }

    // Execute atomic transaction with deterministic row lock on batch
    const result = await this.prisma.$transaction(async (tx) => {
      // Row lock on batch
      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ${batch.id}
        FOR UPDATE
      `;

      // Check available stock in quarantine warehouse
      const sourceMovements = await tx.stockMovement.findMany({
        where: {
          organizationId: orgId,
          warehouseId: sourceWarehouse.id,
          batchId: batch.id,
        },
        select: { quantity: true },
      });

      const physicalAvailable = sourceMovements.reduce((sum, m) => sum + m.quantity, 0);

      if (physicalAvailable < dto.quantity) {
        throw new BadRequestException(
          `Insufficient stock for batch "${batch.batchNumber}" in quarantine warehouse "${sourceWarehouse.name}". Available: ${physicalAvailable}, Requested: ${dto.quantity}`,
        );
      }

      const movementDate = new Date();

      // 1. Create TRANSFER_OUT from source QUARANTINE warehouse
      const outMovement = await tx.stockMovement.create({
        data: {
          organizationId: orgId,
          branchId: sourceWarehouse.branchId,
          warehouseId: sourceWarehouse.id,
          productId: batch.productId,
          batchId: batch.id,
          movementType: StockMovementType.TRANSFER_OUT,
          quantity: -dto.quantity,
          unitCost: batch.purchaseCost,
          referenceType: 'QUARANTINE_RELEASE',
          referenceId: batch.id,
          movementDate,
          notes: `Quarantine Release: ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
          createdByUserId: userId || null,
        },
      });

      // 2. Create TRANSFER_IN to destination STANDARD warehouse
      const inMovement = await tx.stockMovement.create({
        data: {
          organizationId: orgId,
          branchId: destWarehouse.branchId,
          warehouseId: destWarehouse.id,
          productId: batch.productId,
          batchId: batch.id,
          movementType: StockMovementType.TRANSFER_IN,
          quantity: dto.quantity,
          unitCost: batch.purchaseCost,
          referenceType: 'QUARANTINE_RELEASE',
          referenceId: batch.id,
          movementDate,
          notes: `Released from Quarantine (${sourceWarehouse.name}): ${dto.reason}${dto.notes ? ` - ${dto.notes}` : ''}`,
          createdByUserId: userId || null,
        },
      });

      return { outMovement, inMovement };
    });

    // Audit log
    await this.auditService.log({
      userId,
      action: 'RELEASE_QUARANTINE_STOCK',
      entity: 'BATCH',
      entityId: batch.id,
      details: {
        batchNumber: batch.batchNumber,
        productName: batch.product.name,
        quantity: dto.quantity,
        sourceWarehouseId: sourceWarehouse.id,
        sourceWarehouseName: sourceWarehouse.name,
        destWarehouseId: destWarehouse.id,
        destWarehouseName: destWarehouse.name,
        reason: dto.reason,
        notes: dto.notes,
      },
    });

    return {
      success: true,
      message: `Successfully released ${dto.quantity} units of batch ${batch.batchNumber} back to saleable inventory in ${destWarehouse.name}`,
      data: result,
    };
  }

  /**
   * Retrieves all positive stock currently held in Quarantine warehouses.
   */
  async getQuarantineInventory(query: {
    branchId?: string;
    warehouseId?: string;
    productId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const quarantineWarehouses = await this.prisma.warehouse.findMany({
      where: {
        organizationId: orgId,
        warehouseType: 'QUARANTINE',
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.warehouseId ? { id: query.warehouseId } : {}),
      },
      select: { id: true, name: true, code: true, branchId: true },
    });

    if (quarantineWarehouses.length === 0) {
      return {
        data: [],
        pagination: { page: 1, limit: query.limit || 20, totalItems: 0, totalPages: 1, hasMore: false },
      };
    }

    const warehouseIds = quarantineWarehouses.map((w) => w.id);

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        warehouseId: { in: warehouseIds },
        ...(query.productId ? { productId: query.productId } : {}),
      },
      include: {
        product: {
          include: { manufacturer: true, unit: true },
        },
        batch: true,
        warehouse: true,
      },
    });

    // Group by warehouse + batch
    const groupedMap = new Map<
      string,
      {
        warehouseId: string;
        warehouseName: string;
        warehouseCode: string;
        batchId: string;
        batchNumber: string;
        mfgDate: Date | null;
        expiryDate: Date;
        daysToExpiry: number;
        isExpired: boolean;
        batchStatus: BatchStatus;
        productId: string;
        productName: string;
        productSku: string;
        genericName: string;
        manufacturerName: string | null;
        unitSymbol: string | null;
        quantity: number;
        purchaseCost: number;
        tradePrice: number;
        retailPrice: number;
        totalValuation: number;
        latestMovementDate: Date;
        latestReason: string | null;
      }
    >();

    for (const m of movements) {
      const key = `${m.warehouseId}_${m.batchId}`;
      const expiryDate = new Date(m.batch.expiryDate);
      const isExpired = expiryDate <= now;
      const daysToExpiry = Math.ceil(
        (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );

      const existing = groupedMap.get(key) || {
        warehouseId: m.warehouseId,
        warehouseName: m.warehouse.name,
        warehouseCode: m.warehouse.code,
        batchId: m.batchId,
        batchNumber: m.batch.batchNumber,
        mfgDate: m.batch.mfgDate,
        expiryDate: m.batch.expiryDate,
        daysToExpiry,
        isExpired,
        batchStatus: m.batch.status,
        productId: m.productId,
        productName: m.product.name,
        productSku: m.product.sku,
        genericName: m.product.genericName,
        manufacturerName: m.product.manufacturer?.name || null,
        unitSymbol: m.product.unit?.symbol || null,
        quantity: 0,
        purchaseCost: Number(m.batch.purchaseCost),
        tradePrice: Number(m.batch.tradePrice),
        retailPrice: Number(m.batch.retailPrice),
        totalValuation: 0,
        latestMovementDate: m.movementDate,
        latestReason: m.notes,
      };

      existing.quantity += m.quantity;
      if (m.movementDate > existing.latestMovementDate) {
        existing.latestMovementDate = m.movementDate;
        existing.latestReason = m.notes;
      }

      groupedMap.set(key, existing);
    }

    let items = Array.from(groupedMap.values()).filter((i) => i.quantity > 0);

    // Filter by search string if provided
    if (query.search) {
      const searchLower = query.search.toLowerCase();
      items = items.filter(
        (i) =>
          i.batchNumber.toLowerCase().includes(searchLower) ||
          i.productName.toLowerCase().includes(searchLower) ||
          i.productSku.toLowerCase().includes(searchLower) ||
          i.genericName.toLowerCase().includes(searchLower),
      );
    }

    items.forEach((i) => {
      i.totalValuation = Number((i.quantity * i.purchaseCost).toFixed(2));
    });

    const page = query.page || 1;
    const limit = query.limit || 20;
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const paginatedItems = items.slice((page - 1) * limit, page * limit);

    return {
      data: paginatedItems,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  // ==========================================
  // 3. RECALL MANAGEMENT
  // ==========================================

  /**
   * Creates a batch-specific recall.
   * Marks batch status as RECALLED (blocking sales, transfers, FEFO).
   * Optionally auto-quarantines all existing physical stock in standard warehouses.
   */
  async createRecall(dto: CreateRecallDto, userId?: string) {
    const orgId = await this.getOrganizationId();

    const [product, batch] = await Promise.all([
      this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId: orgId },
      }),
      this.prisma.batch.findFirst({
        where: {
          id: dto.batchId,
          productId: dto.productId,
          product: { organizationId: orgId },
        },
      }),
    ]);

    if (!product) {
      throw new NotFoundException('Product not found in organization');
    }
    if (!batch) {
      throw new NotFoundException(
        `Batch with ID "${dto.batchId}" not found for product "${product.name}"`,
      );
    }

    // Generate sequential Recall Number (RCL-00001)
    const { documentNumber } = await this.numberingService.generateNextNumber(
      DocumentType.PRODUCT_RECALL,
    );

    const recall = await this.prisma.$transaction(async (tx) => {
      // 1. Lock batch deterministically
      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ${batch.id}
        FOR UPDATE
      `;

      // 2. Set batch status to RECALLED
      await tx.batch.update({
        where: { id: batch.id },
        data: { status: BatchStatus.RECALLED },
      });

      // 3. Create ProductRecall entry
      const createdRecall = await tx.productRecall.create({
        data: {
          organizationId: orgId,
          recallNumber: documentNumber,
          productId: dto.productId,
          batchId: dto.batchId,
          reason: dto.reason,
          severity: dto.severity || 'HIGH',
          status: RecallStatus.OPEN,
          recallDate: dto.recallDate ? new Date(dto.recallDate) : new Date(),
          notes: dto.notes?.trim() || null,
          createdById: userId || null,
        },
        include: {
          product: true,
          batch: true,
          createdByUser: {
            select: { id: true, username: true, displayName: true },
          },
        },
      });

      // 4. If autoQuarantine is requested, move all positive stock in STANDARD warehouses to QUARANTINE
      if (dto.autoQuarantine) {
        // Find destination quarantine warehouse
        let targetQuarantineWhId = dto.quarantineWarehouseId;
        if (!targetQuarantineWhId) {
          const defaultQuarWh = await tx.warehouse.findFirst({
            where: {
              organizationId: orgId,
              warehouseType: 'QUARANTINE',
            },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          });
          if (defaultQuarWh) {
            targetQuarantineWhId = defaultQuarWh.id;
          }
        }

        if (targetQuarantineWhId) {
          const destWh = await tx.warehouse.findUnique({
            where: { id: targetQuarantineWhId },
          });

          if (destWh && destWh.warehouseType === 'QUARANTINE') {
            // Find all standard movements for this batch
            const standardMovements = await tx.stockMovement.findMany({
              where: {
                organizationId: orgId,
                batchId: batch.id,
                warehouse: { warehouseType: 'STANDARD' },
              },
              include: { warehouse: true },
            });

            // Group by warehouse
            const standardStockByWh = new Map<string, { warehouse: any; quantity: number }>();
            for (const sm of standardMovements) {
              const current = standardStockByWh.get(sm.warehouseId) || {
                warehouse: sm.warehouse,
                quantity: 0,
              };
              current.quantity += sm.quantity;
              standardStockByWh.set(sm.warehouseId, current);
            }

            const movementDate = new Date();

            for (const [, { warehouse: srcWh, quantity: stdQty }] of standardStockByWh.entries()) {
              if (stdQty > 0) {
                // Deduct from standard
                await tx.stockMovement.create({
                  data: {
                    organizationId: orgId,
                    branchId: srcWh.branchId,
                    warehouseId: srcWh.id,
                    productId: batch.productId,
                    batchId: batch.id,
                    movementType: StockMovementType.TRANSFER_OUT,
                    quantity: -stdQty,
                    unitCost: batch.purchaseCost,
                    referenceType: 'RECALL_QUARANTINE',
                    referenceId: createdRecall.id,
                    movementDate,
                    notes: `Auto-Quarantined on Recall ${createdRecall.recallNumber}: ${dto.reason}`,
                    createdByUserId: userId || null,
                  },
                });

                // Add to quarantine
                await tx.stockMovement.create({
                  data: {
                    organizationId: orgId,
                    branchId: destWh.branchId,
                    warehouseId: destWh.id,
                    productId: batch.productId,
                    batchId: batch.id,
                    movementType: StockMovementType.TRANSFER_IN,
                    quantity: stdQty,
                    unitCost: batch.purchaseCost,
                    referenceType: 'RECALL_QUARANTINE',
                    referenceId: createdRecall.id,
                    movementDate,
                    notes: `Auto-Quarantined from ${srcWh.name} on Recall ${createdRecall.recallNumber}`,
                    createdByUserId: userId || null,
                  },
                });
              }
            }
          }
        }
      }

      return createdRecall;
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_PRODUCT_RECALL',
      entity: 'PRODUCT_RECALL',
      entityId: recall.id,
      details: {
        recallNumber: recall.recallNumber,
        productName: product.name,
        batchNumber: batch.batchNumber,
        reason: dto.reason,
        severity: dto.severity,
        autoQuarantine: dto.autoQuarantine,
      },
    });

    return this.getRecallById(recall.id);
  }

  /**
   * Retrieves paginated list of product recalls with affected batch and warehouse quantities.
   */
  async getRecalls(dto: QueryRecallDto) {
    const orgId = await this.getOrganizationId();

    const where: Prisma.ProductRecallWhereInput = {
      organizationId: orgId,
      ...(dto.productId ? { productId: dto.productId } : {}),
      ...(dto.batchId ? { batchId: dto.batchId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.severity ? { severity: dto.severity } : {}),
    };

    if (dto.search) {
      where.OR = [
        { recallNumber: { contains: dto.search, mode: 'insensitive' } },
        { reason: { contains: dto.search, mode: 'insensitive' } },
        { batch: { batchNumber: { contains: dto.search, mode: 'insensitive' } } },
        { product: { name: { contains: dto.search, mode: 'insensitive' } } },
        { product: { sku: { contains: dto.search, mode: 'insensitive' } } },
      ];
    }

    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const skip = (page - 1) * limit;

    const [totalItems, rawRecalls] = await Promise.all([
      this.prisma.productRecall.count({ where }),
      this.prisma.productRecall.findMany({
        where,
        include: {
          product: {
            include: {
              manufacturer: true,
              unit: true,
            },
          },
          batch: true,
          createdByUser: {
            select: { id: true, username: true, displayName: true },
          },
          resolvedByUser: {
            select: { id: true, username: true, displayName: true },
          },
          cancelledByUser: {
            select: { id: true, username: true, displayName: true },
          },
        },
        orderBy: [{ recallDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    // Enhance each recall with physical warehouse quantities
    const data = await Promise.all(
      rawRecalls.map(async (r) => {
        const movements = await this.prisma.stockMovement.findMany({
          where: {
            organizationId: orgId,
            batchId: r.batchId,
          },
          include: {
            warehouse: true,
          },
        });

        let totalPhysicalQuantity = 0;
        let standardQuantity = 0;
        let quarantineQuantity = 0;
        const warehousesMap = new Map<string, { warehouseId: string; name: string; type: string; quantity: number }>();

        for (const m of movements) {
          totalPhysicalQuantity += m.quantity;
          if (m.warehouse.warehouseType === 'STANDARD') {
            standardQuantity += m.quantity;
          } else if (m.warehouse.warehouseType === 'QUARANTINE') {
            quarantineQuantity += m.quantity;
          }

          const existing = warehousesMap.get(m.warehouseId) || {
            warehouseId: m.warehouseId,
            name: m.warehouse.name,
            type: m.warehouse.warehouseType,
            quantity: 0,
          };
          existing.quantity += m.quantity;
          warehousesMap.set(m.warehouseId, existing);
        }

        return {
          id: r.id,
          recallNumber: r.recallNumber,
          reason: r.reason,
          severity: r.severity,
          status: r.status,
          recallDate: r.recallDate,
          notes: r.notes,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          resolvedAt: r.resolvedAt,
          cancelledAt: r.cancelledAt,
          cancellationReason: r.cancellationReason,
          createdByUser: r.createdByUser,
          resolvedByUser: r.resolvedByUser,
          cancelledByUser: r.cancelledByUser,
          product: {
            id: r.product.id,
            sku: r.product.sku,
            name: r.product.name,
            genericName: r.product.genericName,
            manufacturer: r.product.manufacturer?.name || null,
            unit: r.product.unit?.symbol || null,
          },
          batch: {
            id: r.batch.id,
            batchNumber: r.batch.batchNumber,
            mfgDate: r.batch.mfgDate,
            expiryDate: r.batch.expiryDate,
            purchaseCost: Number(r.batch.purchaseCost),
            tradePrice: Number(r.batch.tradePrice),
            retailPrice: Number(r.batch.retailPrice),
            status: r.batch.status,
          },
          stock: {
            totalQuantity: totalPhysicalQuantity,
            standardQuantity: Math.max(0, standardQuantity),
            quarantineQuantity: Math.max(0, quarantineQuantity),
            valuation: Number(
              (totalPhysicalQuantity * Number(r.batch.purchaseCost)).toFixed(2),
            ),
          },
          warehouses: Array.from(warehousesMap.values()).filter((w) => w.quantity > 0),
        };
      }),
    );

    const totalPages = Math.ceil(totalItems / limit) || 1;

    return {
      data,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  /**
   * Retrieves single recall details by ID.
   */
  async getRecallById(id: string) {
    const orgId = await this.getOrganizationId();

    const r = await this.prisma.productRecall.findFirst({
      where: { id, organizationId: orgId },
      include: {
        product: {
          include: {
            manufacturer: true,
            unit: true,
          },
        },
        batch: true,
        createdByUser: {
          select: { id: true, username: true, displayName: true },
        },
        resolvedByUser: {
          select: { id: true, username: true, displayName: true },
        },
        cancelledByUser: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    if (!r) {
      throw new NotFoundException(`Product recall with ID "${id}" not found`);
    }

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        batchId: r.batchId,
      },
      include: {
        warehouse: true,
      },
    });

    let totalPhysicalQuantity = 0;
    let standardQuantity = 0;
    let quarantineQuantity = 0;
    const warehousesMap = new Map<
      string,
      { warehouseId: string; name: string; code: string; type: string; quantity: number }
    >();

    for (const m of movements) {
      totalPhysicalQuantity += m.quantity;
      if (m.warehouse.warehouseType === 'STANDARD') {
        standardQuantity += m.quantity;
      } else if (m.warehouse.warehouseType === 'QUARANTINE') {
        quarantineQuantity += m.quantity;
      }

      const existing = warehousesMap.get(m.warehouseId) || {
        warehouseId: m.warehouseId,
        name: m.warehouse.name,
        code: m.warehouse.code,
        type: m.warehouse.warehouseType,
        quantity: 0,
      };
      existing.quantity += m.quantity;
      warehousesMap.set(m.warehouseId, existing);
    }

    return {
      id: r.id,
      recallNumber: r.recallNumber,
      reason: r.reason,
      severity: r.severity,
      status: r.status,
      recallDate: r.recallDate,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      resolvedAt: r.resolvedAt,
      cancelledAt: r.cancelledAt,
      cancellationReason: r.cancellationReason,
      createdByUser: r.createdByUser,
      resolvedByUser: r.resolvedByUser,
      cancelledByUser: r.cancelledByUser,
      product: {
        id: r.product.id,
        sku: r.product.sku,
        name: r.product.name,
        genericName: r.product.genericName,
        manufacturer: r.product.manufacturer?.name || null,
        unit: r.product.unit?.symbol || null,
      },
      batch: {
        id: r.batch.id,
        batchNumber: r.batch.batchNumber,
        mfgDate: r.batch.mfgDate,
        expiryDate: r.batch.expiryDate,
        purchaseCost: Number(r.batch.purchaseCost),
        tradePrice: Number(r.batch.tradePrice),
        retailPrice: Number(r.batch.retailPrice),
        status: r.batch.status,
      },
      stock: {
        totalQuantity: totalPhysicalQuantity,
        standardQuantity: Math.max(0, standardQuantity),
        quarantineQuantity: Math.max(0, quarantineQuantity),
        valuation: Number(
          (totalPhysicalQuantity * Number(r.batch.purchaseCost)).toFixed(2),
        ),
      },
      warehouses: Array.from(warehousesMap.values()),
    };
  }

  /**
   * Updates recall status (OPEN, IN_PROGRESS, RESOLVED, CANCELLED).
   * Restores Batch status to ACTIVE if recall is closed and no other open recalls exist.
   */
  async updateRecallStatus(
    id: string,
    dto: UpdateRecallStatusDto,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    const recall = await this.prisma.productRecall.findFirst({
      where: { id, organizationId: orgId },
      include: { batch: true },
    });

    if (!recall) {
      throw new NotFoundException(`Product recall with ID "${id}" not found`);
    }

    if (dto.status === RecallStatus.CANCELLED && !dto.cancellationReason) {
      throw new BadRequestException(
        'Cancellation reason is required when cancelling a recall',
      );
    }

    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.ProductRecallUpdateInput = {
        status: dto.status,
        ...(dto.notes ? { notes: dto.notes.trim() } : {}),
      };

      if (dto.status === RecallStatus.RESOLVED) {
        updateData.resolvedAt = now;
        updateData.resolvedByUser = userId ? { connect: { id: userId } } : undefined;
      } else if (dto.status === RecallStatus.CANCELLED) {
        updateData.cancelledAt = now;
        updateData.cancelledByUser = userId ? { connect: { id: userId } } : undefined;
        updateData.cancellationReason = dto.cancellationReason?.trim() || null;
      }

      await tx.productRecall.update({
        where: { id },
        data: updateData,
      });

      // If recall is RESOLVED or CANCELLED, check if any other active recall exists for this batch
      if (
        dto.status === RecallStatus.RESOLVED ||
        dto.status === RecallStatus.CANCELLED
      ) {
        const otherActiveRecalls = await tx.productRecall.findMany({
          where: {
            batchId: recall.batchId,
            id: { not: id },
            status: { in: [RecallStatus.OPEN, RecallStatus.IN_PROGRESS] },
          },
        });

        if (otherActiveRecalls.length === 0) {
          // No other open recall: restore batch to ACTIVE
          await tx.batch.update({
            where: { id: recall.batchId },
            data: { status: BatchStatus.ACTIVE },
          });
        }
      } else if (
        dto.status === RecallStatus.OPEN ||
        dto.status === RecallStatus.IN_PROGRESS
      ) {
        // Re-open / In-Progress marks batch status as RECALLED
        await tx.batch.update({
          where: { id: recall.batchId },
          data: { status: BatchStatus.RECALLED },
        });
      }
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_PRODUCT_RECALL_STATUS',
      entity: 'PRODUCT_RECALL',
      entityId: id,
      details: {
        recallNumber: recall.recallNumber,
        previousStatus: recall.status,
        newStatus: dto.status,
        cancellationReason: dto.cancellationReason,
      },
    });

    return this.getRecallById(id);
  }

  /**
   * Operational action: Quarantines all remaining stock of a recalled batch currently in STANDARD warehouses.
   */
  async quarantineRecalledStock(
    recallId: string,
    quarantineWarehouseId?: string,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    const recall = await this.prisma.productRecall.findFirst({
      where: { id: recallId, organizationId: orgId },
      include: { batch: true, product: true },
    });

    if (!recall) {
      throw new NotFoundException(`Product recall with ID "${recallId}" not found`);
    }

    if (
      recall.status !== RecallStatus.OPEN &&
      recall.status !== RecallStatus.IN_PROGRESS
    ) {
      throw new BadRequestException(
        `Cannot quarantine stock for a recall with status "${recall.status}". Recall must be OPEN or IN_PROGRESS.`,
      );
    }

    // Determine target quarantine warehouse
    let targetWhId = quarantineWarehouseId;
    if (!targetWhId) {
      const defaultQuarWh = await this.prisma.warehouse.findFirst({
        where: {
          organizationId: orgId,
          warehouseType: 'QUARANTINE',
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      if (!defaultQuarWh) {
        throw new BadRequestException(
          'No quarantine warehouse configured in the organization',
        );
      }
      targetWhId = defaultQuarWh.id;
    }

    const destWh = await this.prisma.warehouse.findFirst({
      where: { id: targetWhId, organizationId: orgId },
    });

    if (!destWh || destWh.warehouseType !== 'QUARANTINE') {
      throw new BadRequestException('Destination warehouse must be a QUARANTINE warehouse');
    }

    // Find all positive stock in STANDARD warehouses
    const standardMovements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        batchId: recall.batchId,
        warehouse: { warehouseType: 'STANDARD' },
      },
      include: { warehouse: true },
    });

    const standardStockByWh = new Map<string, { warehouse: any; quantity: number }>();
    for (const sm of standardMovements) {
      const current = standardStockByWh.get(sm.warehouseId) || {
        warehouse: sm.warehouse,
        quantity: 0,
      };
      current.quantity += sm.quantity;
      standardStockByWh.set(sm.warehouseId, current);
    }

    const warehousesWithPositiveStock = Array.from(standardStockByWh.values()).filter(
      (w) => w.quantity > 0,
    );

    if (warehousesWithPositiveStock.length === 0) {
      return {
        success: true,
        movedQuantity: 0,
        message: 'No physical stock found in standard warehouses to quarantine',
      };
    }

    let totalMoved = 0;

    await this.prisma.$transaction(async (tx) => {
      // Row lock on batch
      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ${recall.batchId}
        FOR UPDATE
      `;

      const movementDate = new Date();

      for (const { warehouse: srcWh, quantity: stdQty } of warehousesWithPositiveStock) {
        // Create TRANSFER_OUT from source STANDARD warehouse
        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            branchId: srcWh.branchId,
            warehouseId: srcWh.id,
            productId: recall.productId,
            batchId: recall.batchId,
            movementType: StockMovementType.TRANSFER_OUT,
            quantity: -stdQty,
            unitCost: recall.batch.purchaseCost,
            referenceType: 'RECALL_QUARANTINE',
            referenceId: recall.id,
            movementDate,
            notes: `Recall ${recall.recallNumber} Quarantine: ${recall.reason}`,
            createdByUserId: userId || null,
          },
        });

        // Create TRANSFER_IN to destination QUARANTINE warehouse
        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            branchId: destWh.branchId,
            warehouseId: destWh.id,
            productId: recall.productId,
            batchId: recall.batchId,
            movementType: StockMovementType.TRANSFER_IN,
            quantity: stdQty,
            unitCost: recall.batch.purchaseCost,
            referenceType: 'RECALL_QUARANTINE',
            referenceId: recall.id,
            movementDate,
            notes: `Quarantined from ${srcWh.name} for Recall ${recall.recallNumber}`,
            createdByUserId: userId || null,
          },
        });

        totalMoved += stdQty;
      }
    });

    await this.auditService.log({
      userId,
      action: 'QUARANTINE_RECALLED_STOCK',
      entity: 'PRODUCT_RECALL',
      entityId: recall.id,
      details: {
        recallNumber: recall.recallNumber,
        batchNumber: recall.batch.batchNumber,
        productName: recall.product.name,
        totalMovedQuantity: totalMoved,
        destinationWarehouseId: destWh.id,
        destinationWarehouseName: destWh.name,
      },
    });

    return {
      success: true,
      movedQuantity: totalMoved,
      message: `Successfully transferred ${totalMoved} units of recalled batch ${recall.batch.batchNumber} to ${destWh.name}`,
    };
  }
}
