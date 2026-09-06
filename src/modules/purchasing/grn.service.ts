import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateGoodsReceiveNoteDto } from './dto/create-grn.dto';
import { UpdateGoodsReceiveNoteDto } from './dto/update-grn.dto';
import { QueryGoodsReceiveNoteDto } from './dto/query-grn.dto';
import {
  Prisma,
  DocumentType,
  GrnStatus,
  StockMovementType,
  SupplierLedgerEntryType,
  PurchaseOrderStatus,
  BatchStatus,
} from '@prisma/client';

@Injectable()
export class GrnService {
  private readonly logger = new Logger(GrnService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  /**
   * Helper to calculate item totals and document summary.
   * Bonus units increase physical stock but do not increase invoice line payable.
   */
  private calculateGrnTotals(items: CreateGoodsReceiveNoteDto['items']) {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const computedItems = items.map((item) => {
      const gross = item.receivedQuantity * item.unitCost;
      const discountPct = item.discountPercentage || 0;
      const taxPct = item.taxPercentage || 0;

      const discount = gross * (discountPct / 100);
      const taxable = gross - discount;
      const tax = taxable * (taxPct / 100);
      const lineTotal = taxable + tax;

      subtotal += gross;
      totalDiscount += discount;
      totalTax += tax;

      return {
        poItemId: item.poItemId || null,
        productId: item.productId,
        batchId: item.batchId || null,
        batchNumber: item.batchNumber.trim(),
        mfgDate: item.mfgDate ? new Date(item.mfgDate) : null,
        expiryDate: new Date(item.expiryDate),
        receivedQuantity: item.receivedQuantity,
        bonusQuantity: item.bonusQuantity ? Math.max(0, item.bonusQuantity) : 0,
        unitCost: new Prisma.Decimal(item.unitCost),
        tradePrice: new Prisma.Decimal(item.tradePrice),
        retailPrice: new Prisma.Decimal(item.retailPrice),
        discountPercentage: new Prisma.Decimal(discountPct),
        taxPercentage: new Prisma.Decimal(taxPct),
        lineTotal: new Prisma.Decimal(lineTotal),
        remarks: item.remarks?.trim() || null,
      };
    });

    const netTotal = subtotal - totalDiscount + totalTax;

    return {
      subtotal: new Prisma.Decimal(subtotal),
      discountAmount: new Prisma.Decimal(totalDiscount),
      taxAmount: new Prisma.Decimal(totalTax),
      netTotal: new Prisma.Decimal(netTotal),
      computedItems,
    };
  }

  /**
   * Validates dates for items (mfgDate < expiryDate, expiryDate in future).
   */
  private validateDates(items: CreateGoodsReceiveNoteDto['items']) {
    const now = new Date();
    for (const item of items) {
      const expiry = new Date(item.expiryDate);
      if (isNaN(expiry.getTime())) {
        throw new BadRequestException(`Invalid expiry date for batch "${item.batchNumber}"`);
      }
      if (expiry <= now) {
        throw new BadRequestException(
          `Expiry date for batch "${item.batchNumber}" must be in the future`,
        );
      }
      if (item.mfgDate) {
        const mfg = new Date(item.mfgDate);
        if (isNaN(mfg.getTime())) {
          throw new BadRequestException(`Invalid manufacturing date for batch "${item.batchNumber}"`);
        }
        if (expiry <= mfg) {
          throw new BadRequestException(
            `Expiry date must be after manufacturing date for batch "${item.batchNumber}"`,
          );
        }
      }
    }
  }

  /**
   * Creates a new DRAFT Goods Receive Note (GRN).
   */
  async create(dto: CreateGoodsReceiveNoteDto, userId?: string) {
    const orgId = await this.getOrganizationId();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('GRN must contain at least one line item');
    }

    this.validateDates(dto.items);

    // 1. Verify branch & warehouse hierarchy
    const warehouse = await this.prisma.warehouse.findFirst({
      where: {
        id: dto.warehouseId,
        branchId: dto.branchId,
        organizationId: orgId,
        isActive: true,
      },
      include: { branch: true },
    });

    if (!warehouse || !warehouse.branch || !warehouse.branch.isActive) {
      throw new BadRequestException(
        `Active warehouse with ID "${dto.warehouseId}" not found in branch "${dto.branchId}"`,
      );
    }

    // 2. Verify supplier
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, organizationId: orgId, isActive: true },
    });

    if (!supplier) {
      throw new BadRequestException(`Active supplier with ID "${dto.supplierId}" not found`);
    }

    // 3. Verify PO if linked
    if (dto.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: {
          id: dto.purchaseOrderId,
          organizationId: orgId,
          supplierId: dto.supplierId,
          branchId: dto.branchId,
        },
      });

      if (!po) {
        throw new BadRequestException(
          `Purchase order "${dto.purchaseOrderId}" not found for this supplier & branch`,
        );
      }

      if (po.status === PurchaseOrderStatus.CANCELLED) {
        throw new BadRequestException('Cannot receive goods against a CANCELLED purchase order');
      }
    }

    // 4. Verify all products
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: orgId },
    });

    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException('One or more selected products do not exist for this organization');
    }

    const { subtotal, discountAmount, taxAmount, netTotal, computedItems } =
      this.calculateGrnTotals(dto.items);

    // 5. Generate temporary draft reference number
    const tempDraftNumber = `DRAFT-GRN-${Date.now()}`;

    const grn = await this.prisma.goodsReceiveNote.create({
      data: {
        organizationId: orgId,
        branchId: dto.branchId,
        warehouseId: dto.warehouseId,
        supplierId: dto.supplierId,
        purchaseOrderId: dto.purchaseOrderId || null,
        grnNumber: tempDraftNumber,
        supplierInvoiceNumber: dto.supplierInvoiceNumber?.trim() || null,
        supplierInvoiceDate: dto.supplierInvoiceDate ? new Date(dto.supplierInvoiceDate) : null,
        receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : new Date(),
        status: GrnStatus.DRAFT,
        subtotal,
        discountAmount,
        taxAmount,
        netTotal,
        notes: dto.notes?.trim() || null,
        items: {
          create: computedItems,
        },
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_GOODS_RECEIVE_NOTE',
      entity: 'GOODS_RECEIVE_NOTE',
      entityId: grn.id,
      details: {
        supplier: supplier.name,
        warehouse: warehouse.name,
        itemCount: grn.items.length,
        netTotal: grn.netTotal.toString(),
      },
    });

    return grn;
  }

  /**
   * Retrieves paginated goods receive notes with search and filtering.
   */
  async findAll(query: QueryGoodsReceiveNoteDto) {
    const orgId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.GoodsReceiveNoteWhereInput = {
      organizationId: orgId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.warehouseId) {
      where.warehouseId = query.warehouseId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { grnNumber: { contains: term, mode: 'insensitive' } },
        { supplierInvoiceNumber: { contains: term, mode: 'insensitive' } },
        { supplier: { name: { contains: term, mode: 'insensitive' } } },
        { notes: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.goodsReceiveNote.count({ where }),
      this.prisma.goodsReceiveNote.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ receivedDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, code: true } },
          purchaseOrder: { select: { id: true, poNumber: true } },
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
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Retrieves full GRN by ID with items, products, batches, and movements.
   */
  async findById(id: string) {
    const orgId = await this.getOrganizationId();
    const grn = await this.prisma.goodsReceiveNote.findFirst({
      where: { id, organizationId: orgId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        supplier: true,
        purchaseOrder: true,
        postedByUser: { select: { id: true, displayName: true, username: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
                packSize: true,
                unit: true,
              },
            },
            batch: true,
          },
        },
      },
    });

    if (!grn) {
      throw new NotFoundException(`Goods Receive Note with ID "${id}" not found`);
    }

    return grn;
  }

  /**
   * Updates a DRAFT GRN.
   */
  async update(id: string, dto: UpdateGoodsReceiveNoteDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const grn = await this.prisma.goodsReceiveNote.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true },
    });

    if (!grn) {
      throw new NotFoundException(`Goods Receive Note with ID "${id}" not found`);
    }

    if (grn.status !== GrnStatus.DRAFT) {
      throw new BadRequestException(
        `Only DRAFT goods receive notes can be edited. Current status: ${grn.status}`,
      );
    }

    if (dto.items && dto.items.length > 0) {
      this.validateDates(dto.items);
    }

    return this.prisma.$transaction(async (tx) => {
      let subtotal = grn.subtotal;
      let discountAmount = grn.discountAmount;
      let taxAmount = grn.taxAmount;
      let netTotal = grn.netTotal;

      if (dto.items && dto.items.length > 0) {
        await tx.goodsReceiveNoteItem.deleteMany({
          where: { grnId: id },
        });

        const totals = this.calculateGrnTotals(dto.items);
        subtotal = totals.subtotal;
        discountAmount = totals.discountAmount;
        taxAmount = totals.taxAmount;
        netTotal = totals.netTotal;

        await tx.goodsReceiveNoteItem.createMany({
          data: totals.computedItems.map((item) => ({
            ...item,
            grnId: id,
          })),
        });
      }

      const updated = await tx.goodsReceiveNote.update({
        where: { id },
        data: {
          supplierId: dto.supplierId || undefined,
          warehouseId: dto.warehouseId || undefined,
          supplierInvoiceNumber: dto.supplierInvoiceNumber !== undefined ? dto.supplierInvoiceNumber?.trim() || null : undefined,
          supplierInvoiceDate: dto.supplierInvoiceDate !== undefined ? (dto.supplierInvoiceDate ? new Date(dto.supplierInvoiceDate) : null) : undefined,
          receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
          subtotal,
          discountAmount,
          taxAmount,
          netTotal,
        },
        include: {
          branch: true,
          warehouse: true,
          supplier: true,
          items: {
            include: { product: true },
          },
        },
      });

      await this.auditService.log({
        userId,
        action: 'UPDATE_GOODS_RECEIVE_NOTE',
        entity: 'GOODS_RECEIVE_NOTE',
        entityId: id,
        details: {
          grnNumber: updated.grnNumber,
          netTotal: updated.netTotal.toString(),
        },
      });

      return updated;
    });
  }

  /**
   * ATOMIC POSTING OF GOODS RECEIVE NOTE (GRN).
   * Executes in a single database transaction:
   * 1. Validate DRAFT status.
   * 2. Lock PurchaseOrderItem rows and validate no over-receiving.
   * 3. Register or select Batch (preserving historical purchase cost).
   * 4. Acquire row-level locks on Batches.
   * 5. Post immutable StockMovement records (PURCHASE_RECEIPT).
   * 6. Update PO item received quantities & PO status.
   * 7. Acquire row-level lock on Supplier, update currentBalance, and post SupplierLedgerEntry.
   * 8. Atomically generate permanent sequential document number (GOODS_RECEIVE_NOTE).
   * 9. Mark GRN as POSTED and record AuditLog.
   */
  async postGrn(id: string, userId?: string) {
    const orgId = await this.getOrganizationId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Fetch GRN with items and products
      const grn = await tx.goodsReceiveNote.findFirst({
        where: { id, organizationId: orgId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          supplier: true,
          branch: true,
          warehouse: true,
          purchaseOrder: {
            include: {
              items: true,
            },
          },
        },
      });

      if (!grn) {
        throw new NotFoundException(`Goods Receive Note with ID "${id}" not found`);
      }

      if (grn.status !== GrnStatus.DRAFT) {
        throw new BadRequestException(
          `GRN cannot be posted. Current status: ${grn.status}. Only DRAFT GRNs can be posted.`,
        );
      }

      if (!grn.items || grn.items.length === 0) {
        throw new BadRequestException('Cannot post an empty GRN with no items');
      }

      // 2. Concurrency & Over-receiving Protection on Purchase Orders
      if (grn.purchaseOrderId && grn.purchaseOrder) {
        for (const item of grn.items) {
          if (item.poItemId) {
            // Explicit PostgreSQL row lock on the PO item
            await tx.$queryRaw`SELECT "id" FROM "purchase_order_items" WHERE "id" = ${item.poItemId} FOR UPDATE;`;

            const currentPoItem = await tx.purchaseOrderItem.findUnique({
              where: { id: item.poItemId },
            });

            if (!currentPoItem) {
              throw new BadRequestException(`PO Line Item "${item.poItemId}" no longer exists`);
            }

            const newReceivedQty = currentPoItem.receivedQuantity + item.receivedQuantity;
            if (newReceivedQty > currentPoItem.orderedQuantity) {
              throw new BadRequestException(
                `Over-receiving rejected for "${item.product.name}" (SKU: ${item.product.sku}). ` +
                  `Ordered: ${currentPoItem.orderedQuantity}, Previously Received: ${currentPoItem.receivedQuantity}, ` +
                  `Attempting to Receive: ${item.receivedQuantity} (Total would be ${newReceivedQty}).`,
              );
            }

            // Increment received quantity on PO item
            await tx.purchaseOrderItem.update({
              where: { id: item.poItemId },
              data: { receivedQuantity: newReceivedQty },
            });
          }
        }

        // Re-evaluate overall PO status
        const updatedPoItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: grn.purchaseOrderId },
        });

        const allReceived = updatedPoItems.every((i) => i.receivedQuantity >= i.orderedQuantity);
        const anyReceived = updatedPoItems.some((i) => i.receivedQuantity > 0);

        const newPoStatus = allReceived
          ? PurchaseOrderStatus.RECEIVED
          : anyReceived
          ? PurchaseOrderStatus.PARTIALLY_RECEIVED
          : grn.purchaseOrder.status;

        if (newPoStatus !== grn.purchaseOrder.status) {
          await tx.purchaseOrder.update({
            where: { id: grn.purchaseOrderId },
            data: { status: newPoStatus },
          });
        }
      }

      // 3. Generate permanent sequential GRN Number atomically
      const { documentNumber } = await this.numberingService.generateNextNumber(
        DocumentType.GOODS_RECEIVE_NOTE,
        grn.branchId,
      );

      // 4. Process each line item: Batch handling + StockMovement
      for (const item of grn.items) {
        const batchNumber = item.batchNumber.trim();

        // 4a. Find or create batch
        let batch = await tx.batch.findUnique({
          where: {
            productId_batchNumber: {
              productId: item.productId,
              batchNumber,
            },
          },
        });

        if (!batch) {
          // Create new batch record
          batch = await tx.batch.create({
            data: {
              productId: item.productId,
              batchNumber,
              mfgDate: item.mfgDate,
              expiryDate: item.expiryDate,
              purchaseCost: item.unitCost,
              tradePrice: item.tradePrice,
              retailPrice: item.retailPrice,
              status: BatchStatus.ACTIVE,
              remarks: `Registered on GRN ${documentNumber}`,
            },
          });
        }

        // 4b. Explicit PostgreSQL row lock on the batch
        await tx.$queryRaw`SELECT "id" FROM "batches" WHERE "id" = ${batch.id} FOR UPDATE;`;

        // Update GRN item with the assigned batchId
        await tx.goodsReceiveNoteItem.update({
          where: { id: item.id },
          data: { batchId: batch.id },
        });

        // 4c. Create immutable StockMovement
        // Total physical inflow = billed units + free bonus units
        const totalPhysicalQuantity = item.receivedQuantity + item.bonusQuantity;

        if (totalPhysicalQuantity <= 0) {
          throw new BadRequestException('Physical stock movement quantity must be strictly positive');
        }

        await tx.stockMovement.create({
          data: {
            organizationId: orgId,
            branchId: grn.branchId,
            warehouseId: grn.warehouseId,
            productId: item.productId,
            batchId: batch.id,
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: totalPhysicalQuantity, // Inflow (+)
            unitCost: item.unitCost, // Authoritative historical unit cost snapshot
            referenceType: 'GOODS_RECEIVE_NOTE',
            referenceId: grn.id,
            notes: `Receipt via GRN ${documentNumber} (Paid: ${item.receivedQuantity}, Bonus: ${item.bonusQuantity})`,
            createdByUserId: userId,
          },
        });
      }

      // 5. Supplier Sub-Ledger & Balance Update
      // Acquire row-level lock on supplier
      await tx.$queryRaw`SELECT "id", "current_balance" FROM "suppliers" WHERE "id" = ${grn.supplierId} FOR UPDATE;`;

      const currentSupplier = await tx.supplier.findUnique({
        where: { id: grn.supplierId },
      });

      if (!currentSupplier) {
        throw new BadRequestException(`Supplier with ID "${grn.supplierId}" not found`);
      }

      const previousBalance = Number(currentSupplier.currentBalance);
      const invoiceCredit = Number(grn.netTotal);
      const newBalance = previousBalance + invoiceCredit;

      // 5a. Create SupplierLedgerEntry
      await tx.supplierLedgerEntry.create({
        data: {
          organizationId: orgId,
          branchId: grn.branchId,
          supplierId: grn.supplierId,
          grnId: grn.id,
          entryType: SupplierLedgerEntryType.GRN_INVOICE,
          referenceNumber: documentNumber,
          debit: new Prisma.Decimal(0),
          credit: grn.netTotal,
          runningBalance: new Prisma.Decimal(newBalance),
          notes: `GRN ${documentNumber} - Vendor Invoice ${grn.supplierInvoiceNumber || 'N/A'}`,
          createdByUserId: userId,
        },
      });

      // 5b. Update cached current balance on supplier
      await tx.supplier.update({
        where: { id: grn.supplierId },
        data: {
          currentBalance: new Prisma.Decimal(newBalance),
        },
      });

      // 6. Mark GRN as POSTED
      const postedGrn = await tx.goodsReceiveNote.update({
        where: { id },
        data: {
          grnNumber: documentNumber,
          status: GrnStatus.POSTED,
          paidAmount: new Prisma.Decimal(0),
          balanceAmount: grn.netTotal,
          postedAt: new Date(),
          postedByUserId: userId,
        },
        include: {
          branch: true,
          warehouse: true,
          supplier: true,
          purchaseOrder: true,
          items: {
            include: {
              product: true,
              batch: true,
            },
          },
        },
      });

      // 7. Audit logging
      await this.auditService.log({
        userId,
        action: 'POST_GOODS_RECEIVE_NOTE',
        entity: 'GOODS_RECEIVE_NOTE',
        entityId: grn.id,
        details: {
          grnNumber: documentNumber,
          supplier: grn.supplier.name,
          warehouse: grn.warehouse.name,
          netTotal: grn.netTotal.toString(),
          itemCount: grn.items.length,
        },
      });

      return postedGrn;
    });
  }

  /**
   * Discards a DRAFT GRN.
   */
  async deleteDraft(id: string, userId?: string) {
    const orgId = await this.getOrganizationId();
    const grn = await this.prisma.goodsReceiveNote.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!grn) {
      throw new NotFoundException(`Goods Receive Note with ID "${id}" not found`);
    }

    if (grn.status !== GrnStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT goods receive notes can be discarded');
    }

    await this.prisma.goodsReceiveNote.delete({
      where: { id },
    });

    await this.auditService.log({
      userId,
      action: 'DELETE_DRAFT_GRN',
      entity: 'GOODS_RECEIVE_NOTE',
      entityId: id,
      details: { grnNumber: grn.grnNumber },
    });

    return { success: true, message: 'Draft GRN discarded successfully' };
  }
}
