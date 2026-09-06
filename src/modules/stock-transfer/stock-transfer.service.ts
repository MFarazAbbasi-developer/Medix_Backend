import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { FefoService } from '../inventory/fefo.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { UpdateStockTransferDto } from './dto/update-stock-transfer.dto';
import { DispatchStockTransferDto } from './dto/dispatch-stock-transfer.dto';
import { ReceiveStockTransferDto } from './dto/receive-stock-transfer.dto';
import { CancelStockTransferDto } from './dto/cancel-stock-transfer.dto';
import { QueryStockTransferDto } from './dto/query-stock-transfer.dto';
import { PreviewTransferFefoDto } from './dto/preview-transfer-fefo.dto';
import {
  Prisma,
  DocumentType,
  StockTransferStatus,
  StockMovementType,
} from '@prisma/client';

@Injectable()
export class StockTransferService {
  private readonly logger = new Logger(StockTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
    private readonly fefoService: FefoService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  /**
   * Retrieves paginated stock transfers with filtering.
   */
  async getTransfers(query: QueryStockTransferDto) {
    const orgId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.StockTransferWhereInput = {
      organizationId: orgId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.sourceWarehouseId) {
      where.sourceWarehouseId = query.sourceWarehouseId;
    }

    if (query.destinationWarehouseId) {
      where.destinationWarehouseId = query.destinationWarehouseId;
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.startDate || query.endDate) {
      where.transferDate = {};
      if (query.startDate) {
        where.transferDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.transferDate.lte = new Date(query.endDate);
      }
    }

    if (query.search) {
      where.OR = [
        { transferNumber: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.stockTransfer.count({ where }),
      this.prisma.stockTransfer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { transferDate: 'desc' },
        include: {
          sourceWarehouse: {
            select: { id: true, name: true, code: true, warehouseType: true },
          },
          destinationWarehouse: {
            select: { id: true, name: true, code: true, warehouseType: true },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
          createdByUser: {
            select: { id: true, username: true, displayName: true },
          },
          dispatchedByUser: {
            select: { id: true, username: true, displayName: true },
          },
          receivedByUser: {
            select: { id: true, username: true, displayName: true },
          },
          cancelledByUser: {
            select: { id: true, username: true, displayName: true },
          },
          _count: {
            select: { items: true },
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves single stock transfer by ID with all item details.
   */
  async getTransferById(id: string) {
    const orgId = await this.getOrganizationId();

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        sourceWarehouse: {
          select: { id: true, name: true, code: true, warehouseType: true },
        },
        destinationWarehouse: {
          select: { id: true, name: true, code: true, warehouseType: true },
        },
        branch: {
          select: { id: true, name: true, code: true },
        },
        createdByUser: {
          select: { id: true, username: true, displayName: true },
        },
        dispatchedByUser: {
          select: { id: true, username: true, displayName: true },
        },
        receivedByUser: {
          select: { id: true, username: true, displayName: true },
        },
        cancelledByUser: {
          select: { id: true, username: true, displayName: true },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
                dosageForm: true,
                packSize: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                mfgDate: true,
                purchaseCost: true,
                tradePrice: true,
                retailPrice: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found`);
    }

    return transfer;
  }

  /**
   * FEFO preview for transfer creation.
   */
  async previewFefo(dto: PreviewTransferFefoDto) {
    const orgId = await this.getOrganizationId();

    const warehouse = await this.prisma.warehouse.findFirst({
      where: { id: dto.sourceWarehouseId, organizationId: orgId },
    });

    if (!warehouse) {
      throw new NotFoundException('Source warehouse not found');
    }

    return this.fefoService.allocate({
      organizationId: orgId,
      branchId: warehouse.branchId,
      warehouseId: dto.sourceWarehouseId,
      productId: dto.productId,
      requestedQuantity: dto.quantity,
    });
  }

  /**
   * Creates a draft stock transfer.
   * Does NOT deduct stock.
   */
  async createDraft(dto: CreateStockTransferDto, userId?: string) {
    const orgId = await this.getOrganizationId();

    if (dto.sourceWarehouseId === dto.destinationWarehouseId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one item must be included in the transfer');
    }

    const [sourceWarehouse, destWarehouse] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: dto.sourceWarehouseId, organizationId: orgId },
      }),
      this.prisma.warehouse.findFirst({
        where: { id: dto.destinationWarehouseId, organizationId: orgId },
      }),
    ]);

    if (!sourceWarehouse) {
      throw new NotFoundException('Source warehouse not found');
    }
    if (!destWarehouse) {
      throw new NotFoundException('Destination warehouse not found');
    }

    const branchId = dto.branchId || sourceWarehouse.branchId;

    // Fetch batch details and costs
    const batchIds = dto.items.map((i) => i.batchId);
    const batches = await this.prisma.batch.findMany({
      where: {
        id: { in: batchIds },
        product: { organizationId: orgId },
      },
      include: {
        product: true,
      },
    });

    if (batches.length !== batchIds.length) {
      throw new BadRequestException('One or more batches could not be found');
    }

    const batchMap = new Map(batches.map((b) => [b.id, b]));

    // Generate transfer number
    const { documentNumber } = await this.numberingService.generateNextNumber(
      DocumentType.STOCK_TRANSFER,
      branchId,
    );

    const transfer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stockTransfer.create({
        data: {
          organizationId: orgId,
          branchId,
          transferNumber: documentNumber,
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          transferDate: dto.transferDate ? new Date(dto.transferDate) : new Date(),
          status: StockTransferStatus.DRAFT,
          notes: dto.notes?.trim() || null,
          createdById: userId || null,
          items: {
            create: dto.items.map((item) => {
              const b = batchMap.get(item.batchId)!;
              return {
                productId: item.productId,
                batchId: item.batchId,
                batchNumber: b.batchNumber,
                expiryDate: b.expiryDate,
                requestedQuantity: item.requestedQuantity,
                dispatchedQuantity: 0,
                receivedQuantity: 0,
                unitCost: b.purchaseCost,
                notes: item.notes?.trim() || null,
              };
            }),
          },
        },
        include: {
          items: true,
        },
      });

      return created;
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_STOCK_TRANSFER_DRAFT',
      entity: 'STOCK_TRANSFER',
      entityId: transfer.id,
      details: {
        transferNumber: transfer.transferNumber,
        sourceWarehouseId: transfer.sourceWarehouseId,
        destinationWarehouseId: transfer.destinationWarehouseId,
        itemCount: transfer.items.length,
      },
    });

    return this.getTransferById(transfer.id);
  }

  /**
   * Updates an existing draft transfer.
   */
  async updateDraft(id: string, dto: UpdateStockTransferDto, userId?: string) {
    const orgId = await this.getOrganizationId();

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found`);
    }

    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT transfers can be modified');
    }

    const sourceId = dto.sourceWarehouseId || transfer.sourceWarehouseId;
    const destId = dto.destinationWarehouseId || transfer.destinationWarehouseId;

    if (sourceId === destId) {
      throw new BadRequestException('Source and destination warehouses must be different');
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.items && dto.items.length > 0) {
        const batchIds = dto.items.map((i) => i.batchId);
        const batches = await tx.batch.findMany({
          where: {
            id: { in: batchIds },
            product: { organizationId: orgId },
          },
        });

        if (batches.length !== batchIds.length) {
          throw new BadRequestException('One or more batches could not be found');
        }

        const batchMap = new Map(batches.map((b) => [b.id, b]));

        // Delete old items and insert new
        await tx.stockTransferItem.deleteMany({
          where: { stockTransferId: id },
        });

        await tx.stockTransferItem.createMany({
          data: dto.items.map((item) => {
            const b = batchMap.get(item.batchId)!;
            return {
              stockTransferId: id,
              productId: item.productId,
              batchId: item.batchId,
              batchNumber: b.batchNumber,
              expiryDate: b.expiryDate,
              requestedQuantity: item.requestedQuantity,
              dispatchedQuantity: 0,
              receivedQuantity: 0,
              unitCost: b.purchaseCost,
              notes: item.notes?.trim() || null,
            };
          }),
        });
      }

      await tx.stockTransfer.update({
        where: { id },
        data: {
          sourceWarehouseId: dto.sourceWarehouseId,
          destinationWarehouseId: dto.destinationWarehouseId,
          transferDate: dto.transferDate ? new Date(dto.transferDate) : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        },
      });
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_STOCK_TRANSFER_DRAFT',
      entity: 'STOCK_TRANSFER',
      entityId: id,
      details: {
        transferNumber: transfer.transferNumber,
        changes: dto,
      },
    });

    return this.getTransferById(id);
  }

  /**
   * Dispatches a stock transfer.
   * Deducts stock from source warehouse and puts stock into transit.
   */
  async dispatchTransfer(
    id: string,
    dto: DispatchStockTransferDto,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: {
          include: {
            batch: true,
            product: true,
          },
        },
        sourceWarehouse: true,
        destinationWarehouse: true,
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found`);
    }

    if (transfer.status !== StockTransferStatus.DRAFT) {
      throw new BadRequestException(
        `Cannot dispatch transfer with status "${transfer.status}". Only DRAFT transfers can be dispatched.`,
      );
    }

    if (transfer.items.length === 0) {
      throw new BadRequestException('Transfer has no items to dispatch');
    }

    // Check destination warehouse type: if STANDARD, reject quarantined/recalled/expired items
    if (transfer.destinationWarehouse.warehouseType === 'STANDARD') {
      const now = new Date();
      for (const item of transfer.items) {
        if (item.batch.status !== 'ACTIVE') {
          throw new BadRequestException(
            `Batch "${item.batch.batchNumber}" has status "${item.batch.status}" and cannot be transferred into a STANDARD saleable warehouse`,
          );
        }
        if (new Date(item.batch.expiryDate) <= now) {
          throw new BadRequestException(
            `Batch "${item.batch.batchNumber}" is expired and cannot be transferred into a STANDARD saleable warehouse`,
          );
        }
      }
    }

    // Determine dispatch quantities for each item
    const dispatchQtyMap = new Map<string, number>();
    if (dto.items && dto.items.length > 0) {
      for (const override of dto.items) {
        dispatchQtyMap.set(override.itemId, override.dispatchedQuantity);
      }
    }

    const itemsToDispatch = transfer.items.map((item) => {
      const qty = dispatchQtyMap.get(item.id) ?? item.requestedQuantity;
      if (qty <= 0) {
        throw new BadRequestException(
          `Dispatch quantity for item ${item.batch.batchNumber} must be greater than zero`,
        );
      }
      return {
        item,
        dispatchQty: qty,
      };
    });

    // Execute atomic transaction with deterministic row locks
    await this.prisma.$transaction(async (tx) => {
      // 1. Sort batch IDs deterministically to avoid deadlocks
      const sortedBatchIds = [
        ...new Set(itemsToDispatch.map((i) => i.item.batchId)),
      ].sort();

      // Acquire exclusive lock on batches
      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ANY(${sortedBatchIds}::text[])
        FOR UPDATE
      `;

      // 2. Validate physical stock in source warehouse inside transaction
      for (const { item, dispatchQty } of itemsToDispatch) {
        const movements = await tx.stockMovement.findMany({
          where: {
            organizationId: orgId,
            warehouseId: transfer.sourceWarehouseId,
            batchId: item.batchId,
          },
          select: { quantity: true },
        });

        const physicalAvailable = movements.reduce((sum, m) => sum + m.quantity, 0);

        if (physicalAvailable < dispatchQty) {
          throw new BadRequestException(
            `Insufficient stock for batch "${item.batch.batchNumber}" in source warehouse "${transfer.sourceWarehouse.name}". Available: ${physicalAvailable}, Required: ${dispatchQty}`,
          );
        }

        // 3. Create negative StockMovement (TRANSFER_OUT)
        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            branchId: transfer.branchId,
            warehouseId: transfer.sourceWarehouseId,
            productId: item.productId,
            batchId: item.batchId,
            movementType: StockMovementType.TRANSFER_OUT,
            quantity: -dispatchQty,
            unitCost: item.unitCost,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            movementDate: new Date(),
            notes: `Dispatched via transfer ${transfer.transferNumber} to ${transfer.destinationWarehouse.name}`,
            createdByUserId: userId || null,
          },
        });

        // 4. Update item dispatchedQuantity
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: {
            dispatchedQuantity: dispatchQty,
          },
        });
      }

      // 5. Update transfer status
      await tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: StockTransferStatus.DISPATCHED,
          dispatchedAt: new Date(),
          dispatchedById: userId || null,
          notes: dto.notes ? dto.notes.trim() : transfer.notes,
        },
      });
    });

    await this.auditService.log({
      userId,
      action: 'DISPATCH_STOCK_TRANSFER',
      entity: 'STOCK_TRANSFER',
      entityId: transfer.id,
      details: {
        transferNumber: transfer.transferNumber,
        sourceWarehouseId: transfer.sourceWarehouseId,
        destinationWarehouseId: transfer.destinationWarehouseId,
        dispatchedItems: itemsToDispatch.map((i) => ({
          batchNumber: i.item.batchNumber,
          dispatchedQuantity: i.dispatchQty,
        })),
      },
    });

    return this.getTransferById(id);
  }

  /**
   * Receives a stock transfer into the destination warehouse.
   * Supports partial receiving. Stock becomes available upon receipt.
   */
  async receiveTransfer(
    id: string,
    dto: ReceiveStockTransferDto,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: {
          include: {
            batch: true,
            product: true,
          },
        },
        sourceWarehouse: true,
        destinationWarehouse: true,
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found`);
    }

    if (
      transfer.status !== StockTransferStatus.DISPATCHED &&
      transfer.status !== StockTransferStatus.PARTIALLY_RECEIVED
    ) {
      throw new BadRequestException(
        `Cannot receive transfer with status "${transfer.status}". Only DISPATCHED or PARTIALLY_RECEIVED transfers can be received.`,
      );
    }

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Please specify items and quantities to receive');
    }

    const itemMap = new Map(transfer.items.map((i) => [i.id, i]));
    const receivePlan: Array<{
      item: (typeof transfer.items)[0];
      qtyToReceive: number;
    }> = [];

    for (const entry of dto.items) {
      const item = itemMap.get(entry.itemId);
      if (!item) {
        throw new BadRequestException(`Item with ID "${entry.itemId}" not found in this transfer`);
      }

      if (entry.receivedQuantity <= 0) {
        throw new BadRequestException('Received quantity must be greater than zero');
      }

      const pendingQty = item.dispatchedQuantity - item.receivedQuantity;
      if (entry.receivedQuantity > pendingQty) {
        throw new BadRequestException(
          `Cannot receive ${entry.receivedQuantity} for batch "${item.batchNumber}". Maximum receivable in-transit quantity is ${pendingQty}`,
        );
      }

      receivePlan.push({
        item,
        qtyToReceive: entry.receivedQuantity,
      });
    }

    // Execute atomic receiving transaction
    await this.prisma.$transaction(async (tx) => {
      // Sort batch IDs deterministically
      const sortedBatchIds = [
        ...new Set(receivePlan.map((p) => p.item.batchId)),
      ].sort();

      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ANY(${sortedBatchIds}::text[])
        FOR UPDATE
      `;

      for (const { item, qtyToReceive } of receivePlan) {
        // 1. Create positive StockMovement into destination warehouse
        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            branchId: transfer.branchId,
            warehouseId: transfer.destinationWarehouseId,
            productId: item.productId,
            batchId: item.batchId,
            movementType: StockMovementType.TRANSFER_IN,
            quantity: qtyToReceive,
            unitCost: item.unitCost,
            referenceType: 'STOCK_TRANSFER',
            referenceId: transfer.id,
            movementDate: new Date(),
            notes: `Received via transfer ${transfer.transferNumber} from ${transfer.sourceWarehouse.name}`,
            createdByUserId: userId || null,
          },
        });

        // 2. Increment item receivedQuantity
        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: {
            receivedQuantity: item.receivedQuantity + qtyToReceive,
          },
        });
      }

      // 3. Determine if transfer is fully received
      const updatedItems = await tx.stockTransferItem.findMany({
        where: { stockTransferId: id },
      });

      const isFullyReceived = updatedItems.every(
        (i) => i.receivedQuantity >= i.dispatchedQuantity && i.dispatchedQuantity > 0,
      );

      const newStatus = isFullyReceived
        ? StockTransferStatus.RECEIVED
        : StockTransferStatus.PARTIALLY_RECEIVED;

      await tx.stockTransfer.update({
        where: { id },
        data: {
          status: newStatus,
          receivedAt: isFullyReceived ? new Date() : undefined,
          receivedById: isFullyReceived ? userId || null : undefined,
          notes: dto.notes ? dto.notes.trim() : transfer.notes,
        },
      });
    });

    await this.auditService.log({
      userId,
      action: 'RECEIVE_STOCK_TRANSFER',
      entity: 'STOCK_TRANSFER',
      entityId: transfer.id,
      details: {
        transferNumber: transfer.transferNumber,
        destinationWarehouseId: transfer.destinationWarehouseId,
        receivedEntries: receivePlan.map((p) => ({
          batchNumber: p.item.batchNumber,
          quantity: p.qtyToReceive,
        })),
      },
    });

    return this.getTransferById(id);
  }

  /**
   * Cancels a stock transfer.
   * If DRAFT: cancels without stock movement.
   * If DISPATCHED or PARTIALLY_RECEIVED: reverses in-transit stock back to source,
   * and reverses any already received stock from destination back to source safely.
   */
  async cancelTransfer(
    id: string,
    dto: CancelStockTransferDto,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    const transfer = await this.prisma.stockTransfer.findFirst({
      where: { id, organizationId: orgId },
      include: {
        items: {
          include: {
            batch: true,
          },
        },
        sourceWarehouse: true,
        destinationWarehouse: true,
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Stock transfer with ID "${id}" not found`);
    }

    if (
      transfer.status === StockTransferStatus.RECEIVED ||
      transfer.status === StockTransferStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot cancel transfer with status "${transfer.status}"`,
      );
    }

    if (transfer.status === StockTransferStatus.DRAFT) {
      // Simply cancel draft
      const updated = await this.prisma.stockTransfer.update({
        where: { id },
        data: {
          status: StockTransferStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId || null,
          cancellationReason: dto.cancellationReason.trim(),
        },
      });

      await this.auditService.log({
        userId,
        action: 'CANCEL_STOCK_TRANSFER_DRAFT',
        entity: 'STOCK_TRANSFER',
        entityId: id,
        details: {
          transferNumber: transfer.transferNumber,
          reason: dto.cancellationReason,
        },
      });

      return this.getTransferById(updated.id);
    }

    // Reversal for DISPATCHED or PARTIALLY_RECEIVED
    await this.prisma.$transaction(async (tx) => {
      // Deterministic batch locks
      const sortedBatchIds = [
        ...new Set(transfer.items.map((i) => i.batchId)),
      ].sort();

      await tx.$queryRaw`
        SELECT id FROM "batches"
        WHERE id = ANY(${sortedBatchIds}::text[])
        FOR UPDATE
      `;

      for (const item of transfer.items) {
        // 1. In-transit stock (dispatched - received): restore back to source
        const inTransit = item.dispatchedQuantity - item.receivedQuantity;
        if (inTransit > 0) {
          await tx.stockMovement.create({
            data: {
              organizationId: orgId,
              branchId: transfer.branchId,
              warehouseId: transfer.sourceWarehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType: StockMovementType.TRANSFER_IN,
              quantity: inTransit,
              unitCost: item.unitCost,
              referenceType: 'STOCK_TRANSFER_REVERSAL',
              referenceId: transfer.id,
              movementDate: new Date(),
              notes: `Transfer cancellation: in-transit stock restored to ${transfer.sourceWarehouse.name}`,
              createdByUserId: userId || null,
            },
          });
        }

        // 2. Already received stock in destination: validate and reverse back to source
        if (item.receivedQuantity > 0) {
          const destMovements = await tx.stockMovement.findMany({
            where: {
              organizationId: orgId,
              warehouseId: transfer.destinationWarehouseId,
              batchId: item.batchId,
            },
            select: { quantity: true },
          });

          const destAvailable = destMovements.reduce((sum, m) => sum + m.quantity, 0);

          if (destAvailable < item.receivedQuantity) {
            throw new BadRequestException(
              `Cannot cancel transfer: destination warehouse "${transfer.destinationWarehouse.name}" has insufficient stock of batch "${item.batchNumber}" to reverse (Available: ${destAvailable}, Needed: ${item.receivedQuantity})`,
            );
          }

          // Deduct from destination
          await tx.stockMovement.create({
            data: {
              organizationId: orgId,
              branchId: transfer.branchId,
              warehouseId: transfer.destinationWarehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType: StockMovementType.TRANSFER_OUT,
              quantity: -item.receivedQuantity,
              unitCost: item.unitCost,
              referenceType: 'STOCK_TRANSFER_REVERSAL',
              referenceId: transfer.id,
              movementDate: new Date(),
              notes: `Transfer cancellation: received stock deducted from ${transfer.destinationWarehouse.name}`,
              createdByUserId: userId || null,
            },
          });

          // Restore to source
          await tx.stockMovement.create({
            data: {
              organizationId: orgId,
              branchId: transfer.branchId,
              warehouseId: transfer.sourceWarehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType: StockMovementType.TRANSFER_IN,
              quantity: item.receivedQuantity,
              unitCost: item.unitCost,
              referenceType: 'STOCK_TRANSFER_REVERSAL',
              referenceId: transfer.id,
              movementDate: new Date(),
              notes: `Transfer cancellation: received stock returned to ${transfer.sourceWarehouse.name}`,
              createdByUserId: userId || null,
            },
          });
        }
      }

      await tx.stockTransfer.update({
        where: { id },
        data: {
          status: StockTransferStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelledById: userId || null,
          cancellationReason: dto.cancellationReason.trim(),
        },
      });
    });

    await this.auditService.log({
      userId,
      action: 'CANCEL_STOCK_TRANSFER',
      entity: 'STOCK_TRANSFER',
      entityId: id,
      details: {
        transferNumber: transfer.transferNumber,
        reason: dto.cancellationReason,
      },
    });

    return this.getTransferById(id);
  }

  /**
   * Retrieves operational metrics and summary KPIs for stock transfers.
   */
  async getMetrics(branchId?: string) {
    const orgId = await this.getOrganizationId();

    const baseWhere: Prisma.StockTransferWhereInput = {
      organizationId: orgId,
    };
    if (branchId) {
      baseWhere.branchId = branchId;
    }

    const [totalTransfers, draftCount, inTransitCount, receivedCount, cancelledCount] =
      await Promise.all([
        this.prisma.stockTransfer.count({ where: baseWhere }),
        this.prisma.stockTransfer.count({
          where: { ...baseWhere, status: StockTransferStatus.DRAFT },
        }),
        this.prisma.stockTransfer.count({
          where: {
            ...baseWhere,
            status: {
              in: [
                StockTransferStatus.DISPATCHED,
                StockTransferStatus.PARTIALLY_RECEIVED,
              ],
            },
          },
        }),
        this.prisma.stockTransfer.count({
          where: { ...baseWhere, status: StockTransferStatus.RECEIVED },
        }),
        this.prisma.stockTransfer.count({
          where: { ...baseWhere, status: StockTransferStatus.CANCELLED },
        }),
      ]);

    return {
      totalTransfers,
      draftCount,
      inTransitCount,
      receivedCount,
      cancelledCount,
    };
  }
}
