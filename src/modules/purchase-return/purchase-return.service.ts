import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { QueryPurchaseReturnDto } from './dto/query-purchase-return.dto';
import { CancelPurchaseReturnDto } from './dto/cancel-purchase-return.dto';
import {
  Prisma,
  DocumentType,
  PurchaseReturnStatus,
  GrnStatus,
  SupplierLedgerEntryType,
  StockMovementType,
  ReturnedStockCondition,
  WarehouseType,
  SupplierPaymentStatus,
} from '@prisma/client';

@Injectable()
export class PurchaseReturnService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  private async getDefaultBranchId(organizationId: string): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { organizationId, isActive: true },
      orderBy: [{ isHeadOffice: 'desc' }, { createdAt: 'asc' }],
    });
    if (!branch) {
      throw new NotFoundException('No active branch found');
    }
    return branch.id;
  }

  /**
   * Retrieves returnable line items and settlement limits for a posted GRN.
   */
  async getReturnableGrn(grnId: string) {
    const organizationId = await this.getOrganizationId();

    const grn = await this.prisma.goodsReceiveNote.findFirst({
      where: { id: grnId, organizationId },
      include: {
        supplier: true,
        branch: {
          select: { id: true, name: true, code: true },
        },
        warehouse: {
          select: { id: true, name: true, code: true, warehouseType: true },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
                packSize: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                status: true,
              },
            },
          },
        },
        purchaseReturns: {
          where: {
            status: {
              in: [
                PurchaseReturnStatus.DRAFT,
                PurchaseReturnStatus.DISPATCHED,
                PurchaseReturnStatus.COMPLETED,
              ],
            },
          },
          include: { items: true },
        },
      },
    });

    if (!grn) {
      throw new NotFoundException(`Goods Receive Note with ID "${grnId}" not found`);
    }

    if (grn.status !== GrnStatus.POSTED) {
      throw new BadRequestException(
        `Cannot issue a purchase return against GRN with status "${grn.status}". Only POSTED GRNs can be returned.`,
      );
    }

    // Cumulative returned quantities per GRN item line (for active returns)
    const returnedMap: Record<string, { billed: number; bonus: number }> = {};
    for (const ret of grn.purchaseReturns) {
      for (const item of ret.items) {
        if (item.grnItemId) {
          if (!returnedMap[item.grnItemId]) {
            returnedMap[item.grnItemId] = { billed: 0, bonus: 0 };
          }
          returnedMap[item.grnItemId].billed += item.returnedQuantity;
          returnedMap[item.grnItemId].bonus += item.bonusReturnedQuantity;
        }
      }
    }

    const returnableItems = grn.items.map((item) => {
      const prior = returnedMap[item.id] || { billed: 0, bonus: 0 };
      const availableBilled = Math.max(0, item.receivedQuantity - prior.billed);
      const availableBonus = Math.max(0, item.bonusQuantity - prior.bonus);

      const isExpired = new Date(item.expiryDate) <= new Date();
      const isBatchActive = item.batch?.status === 'ACTIVE';
      const canReturnAsSaleable = !isExpired && isBatchActive;

      return {
        id: item.id,
        productId: item.productId,
        productName: item.product.name,
        productSku: item.product.sku,
        batchId: item.batchId,
        batchNumber: item.batchNumber,
        expiryDate: item.expiryDate,
        receivedQuantity: item.receivedQuantity,
        bonusQuantity: item.bonusQuantity,
        totalQuantity: item.receivedQuantity + item.bonusQuantity,
        priorReturnedBilled: prior.billed,
        priorReturnedBonus: prior.bonus,
        availableBilled,
        availableBonus,
        unitCost: Number(item.unitCost),
        discountPercentage: Number(item.discountPercentage),
        taxPercentage: Number(item.taxPercentage),
        tradePrice: Number(item.tradePrice),
        retailPrice: Number(item.retailPrice),
        canReturnAsSaleable,
        isExpired,
      };
    });

    return {
      grn: {
        id: grn.id,
        grnNumber: grn.grnNumber,
        supplierInvoiceNumber: grn.supplierInvoiceNumber,
        supplierInvoiceDate: grn.supplierInvoiceDate,
        receivedDate: grn.receivedDate,
        supplierId: grn.supplierId,
        supplierName: grn.supplier.name,
        supplierCode: grn.supplier.code,
        warehouseId: grn.warehouseId,
        warehouseName: grn.warehouse.name,
        netTotal: Number(grn.netTotal),
        paidAmount: Number(grn.paidAmount),
        balanceAmount: Number(grn.balanceAmount),
        status: grn.status,
      },
      items: returnableItems,
    };
  }

  /**
   * Retrieves available batches in inventory for direct (non-GRN) returns.
   */
  async getReturnableBatches(query: {
    supplierId?: string;
    warehouseId?: string;
    search?: string;
  }) {
    const orgId = await this.getOrganizationId();
    const now = new Date();

    const movements = await this.prisma.stockMovement.findMany({
      where: {
        organizationId: orgId,
        ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
      },
      include: {
        warehouse: true,
        batch: {
          include: {
            product: {
              include: {
                manufacturer: true,
                unit: true,
              },
            },
          },
        },
      },
    });

    const stockMap = new Map<
      string,
      {
        warehouseId: string;
        warehouseName: string;
        warehouseCode: string;
        warehouseType: string;
        productId: string;
        productName: string;
        productSku: string;
        genericName: string | null;
        unit: string | null;
        batchId: string;
        batchNumber: string;
        expiryDate: Date;
        isExpired: boolean;
        batchStatus: string;
        purchaseCost: number;
        availableQuantity: number;
      }
    >();

    for (const m of movements) {
      const key = `${m.warehouseId}_${m.batchId}`;
      const existing = stockMap.get(key) || {
        warehouseId: m.warehouseId,
        warehouseName: m.warehouse.name,
        warehouseCode: m.warehouse.code,
        warehouseType: m.warehouse.warehouseType,
        productId: m.productId,
        productName: m.batch.product.name,
        productSku: m.batch.product.sku,
        genericName: m.batch.product.genericName,
        unit: m.batch.product.unit ? m.batch.product.unit.symbol : null,
        batchId: m.batchId,
        batchNumber: m.batch.batchNumber,
        expiryDate: m.batch.expiryDate,
        isExpired: new Date(m.batch.expiryDate) <= now,
        batchStatus: m.batch.status,
        purchaseCost: Number(m.batch.purchaseCost),
        availableQuantity: 0,
      };

      existing.availableQuantity += m.quantity;
      stockMap.set(key, existing);
    }

    let items = Array.from(stockMap.values()).filter((i) => i.availableQuantity > 0);

    if (query.search) {
      const s = query.search.toLowerCase();
      items = items.filter(
        (i) =>
          i.productName.toLowerCase().includes(s) ||
          i.productSku.toLowerCase().includes(s) ||
          i.batchNumber.toLowerCase().includes(s) ||
          (i.genericName && i.genericName.toLowerCase().includes(s)),
      );
    }

    return items;
  }

  /**
   * Creates a Purchase Return document strictly in DRAFT status.
   * Does NOT deduct stock and does NOT post to supplier ledger.
   */
  async createPurchaseReturn(dto: CreatePurchaseReturnDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Purchase return must contain at least one item line');
    }

    const hasQuantity = dto.items.some(
      (item) => item.returnedQuantity > 0 || (item.bonusReturnedQuantity || 0) > 0,
    );
    if (!hasQuantity) {
      throw new BadRequestException(
        'At least one line item must have a return quantity greater than 0',
      );
    }

    return this.prisma.$transaction(
      async (tx) => {
        let resolvedSupplierId: string;
        let lockedGrn: {
          id: string;
          organization_id: string;
          branch_id: string;
          supplier_id: string;
          grn_number: string;
          status: string;
          net_total: Prisma.Decimal;
          paid_amount: Prisma.Decimal;
          balance_amount: Prisma.Decimal;
        } | null = null;

        let grnItemMap = new Map<string, any>();
        const returnedCumulativeMap: Record<string, { billed: number; bonus: number }> = {};

        // 1. If GRN-linked: lock GRN and validate
        if (dto.grnId) {
          const lockedGrns = await tx.$queryRaw<
            Array<{
              id: string;
              organization_id: string;
              branch_id: string;
              supplier_id: string;
              grn_number: string;
              status: string;
              net_total: Prisma.Decimal;
              paid_amount: Prisma.Decimal;
              balance_amount: Prisma.Decimal;
            }>
          >`
            SELECT id, organization_id, branch_id, supplier_id, grn_number, status, net_total, paid_amount, balance_amount
            FROM goods_receive_notes
            WHERE id = ${dto.grnId} AND organization_id = ${organizationId}
            FOR UPDATE
          `;

          if (!lockedGrns.length) {
            throw new NotFoundException(`Goods Receive Note with ID "${dto.grnId}" not found`);
          }

          lockedGrn = lockedGrns[0];
          if (lockedGrn.status !== GrnStatus.POSTED) {
            throw new BadRequestException(
              `Cannot issue a purchase return against GRN "${lockedGrn.grn_number}" with status ${lockedGrn.status}`,
            );
          }
          resolvedSupplierId = lockedGrn.supplier_id;

          const grnItems = await tx.goodsReceiveNoteItem.findMany({
            where: { grnId: lockedGrn.id },
            include: {
              batch: true,
              product: true,
            },
          });
          grnItemMap = new Map(grnItems.map((item) => [item.id, item]));

          const priorReturns = await tx.purchaseReturn.findMany({
            where: {
              grnId: lockedGrn.id,
              status: {
                in: [
                  PurchaseReturnStatus.DRAFT,
                  PurchaseReturnStatus.DISPATCHED,
                  PurchaseReturnStatus.COMPLETED,
                ],
              },
            },
            include: { items: true },
          });

          for (const ret of priorReturns) {
            for (const item of ret.items) {
              if (item.grnItemId) {
                if (!returnedCumulativeMap[item.grnItemId]) {
                  returnedCumulativeMap[item.grnItemId] = { billed: 0, bonus: 0 };
                }
                returnedCumulativeMap[item.grnItemId].billed += item.returnedQuantity;
                returnedCumulativeMap[item.grnItemId].bonus += item.bonusReturnedQuantity;
              }
            }
          }
        } else {
          if (!dto.supplierId) {
            throw new BadRequestException(
              'Supplier ID is required when creating a direct purchase return without a GRN linkage',
            );
          }
          resolvedSupplierId = dto.supplierId;
        }

        // 2. Lock Supplier row with FOR UPDATE
        const lockedSuppliers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string; is_active: boolean }>
        >`
          SELECT id, current_balance, name, is_active FROM suppliers
          WHERE id = ${resolvedSupplierId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedSuppliers.length) {
          throw new NotFoundException('Supplier not found');
        }
        const lockedSupplier = lockedSuppliers[0];
        if (!lockedSupplier.is_active) {
          throw new BadRequestException(`Supplier "${lockedSupplier.name}" is deactivated`);
        }

        // 3. Validate lines and compute snapshotted financials
        let returnSubtotal = 0;
        let returnDiscountAmount = 0;
        let returnTaxAmount = 0;
        let returnNetTotal = 0;

        const resolvedReturnLines: Array<{
          grnItemId: string | null;
          productId: string;
          batchId: string;
          batchNumber: string;
          expiryDate: Date;
          sourceWarehouseId: string;
          returnedQuantity: number;
          bonusReturnedQuantity: number;
          totalReturnedQuantity: number;
          stockCondition: ReturnedStockCondition;
          unitCost: Prisma.Decimal;
          discountPercentage: Prisma.Decimal;
          discountAmount: Prisma.Decimal;
          taxPercentage: Prisma.Decimal;
          taxAmount: Prisma.Decimal;
          lineTotal: Prisma.Decimal;
        }> = [];

        const now = new Date();

        for (const itemDto of dto.items) {
          const retQty = itemDto.returnedQuantity || 0;
          const bonusRetQty = itemDto.bonusReturnedQuantity || 0;
          const totalRetQty = retQty + bonusRetQty;

          if (totalRetQty <= 0) {
            continue;
          }

          let productId: string;
          let batchId: string;
          let batchNumber: string;
          let expiryDate: Date;
          let unitCostDecimal: Prisma.Decimal;
          let discPctDecimal: Prisma.Decimal;
          let taxPctDecimal: Prisma.Decimal;
          let isExpired: boolean;
          let isBatchActive: boolean;

          if (itemDto.grnItemId) {
            const grnItem = grnItemMap.get(itemDto.grnItemId);
            if (!grnItem) {
              throw new NotFoundException(
                `GRN Item "${itemDto.grnItemId}" not found in this GRN`,
              );
            }

            const prior = returnedCumulativeMap[grnItem.id] || { billed: 0, bonus: 0 };
            const maxBilled = grnItem.receivedQuantity - prior.billed;
            const maxBonus = grnItem.bonusQuantity - prior.bonus;

            if (retQty > maxBilled) {
              throw new BadRequestException(
                `Returned billed quantity (${retQty}) exceeds available returnable quantity (${maxBilled}) for "${grnItem.product.name}" (Batch: ${grnItem.batchNumber})`,
              );
            }

            if (bonusRetQty > maxBonus) {
              throw new BadRequestException(
                `Returned bonus quantity (${bonusRetQty}) exceeds available returnable bonus quantity (${maxBonus}) for "${grnItem.product.name}" (Batch: ${grnItem.batchNumber})`,
              );
            }

            productId = grnItem.productId;
            batchId = grnItem.batchId;
            batchNumber = grnItem.batchNumber;
            expiryDate = grnItem.expiryDate;
            unitCostDecimal = grnItem.unitCost;
            discPctDecimal = grnItem.discountPercentage;
            taxPctDecimal = grnItem.taxPercentage;
            isExpired = new Date(grnItem.expiryDate) <= now;
            isBatchActive = grnItem.batch?.status === 'ACTIVE';
          } else {
            if (!itemDto.productId || !itemDto.batchId) {
              throw new BadRequestException(
                'Product ID and Batch ID are required for direct-batch return lines',
              );
            }

            const [batch, product] = await Promise.all([
              tx.batch.findFirst({
                where: {
                  id: itemDto.batchId,
                  productId: itemDto.productId,
                  product: { organizationId },
                },
              }),
              tx.product.findFirst({
                where: { id: itemDto.productId, organizationId },
              }),
            ]);

            if (!product || !batch) {
              throw new NotFoundException(
                `Product or Batch not found for batch ID "${itemDto.batchId}"`,
              );
            }

            productId = product.id;
            batchId = batch.id;
            batchNumber = batch.batchNumber;
            expiryDate = batch.expiryDate;
            unitCostDecimal = batch.purchaseCost; // Authoritative acquisition cost snapshot
            discPctDecimal = new Prisma.Decimal(0);
            taxPctDecimal = new Prisma.Decimal(0);
            isExpired = new Date(batch.expiryDate) <= now;
            isBatchActive = batch.status === 'ACTIVE';
          }

          // Verify source warehouse & stock condition
          const sourceWh = await tx.warehouse.findFirst({
            where: {
              id: itemDto.sourceWarehouseId,
              organizationId,
              isActive: true,
            },
          });

          if (!sourceWh) {
            throw new BadRequestException(
              `Source warehouse with ID "${itemDto.sourceWarehouseId}" not found or deactivated`,
            );
          }

          if (itemDto.stockCondition === ReturnedStockCondition.SALEABLE) {
            if (sourceWh.warehouseType !== WarehouseType.STANDARD) {
              throw new BadRequestException(
                `SALEABLE returns must be drawn from a STANDARD warehouse. Warehouse "${sourceWh.name}" is designated as ${sourceWh.warehouseType}.`,
              );
            }

            if (isExpired || !isBatchActive) {
              throw new BadRequestException(
                `Expired or inactive batch "${batchNumber}" cannot be returned as SALEABLE. Condition must be set to QUARANTINED.`,
              );
            }
          } else if (itemDto.stockCondition === ReturnedStockCondition.QUARANTINED) {
            if (sourceWh.warehouseType !== WarehouseType.QUARANTINE) {
              throw new BadRequestException(
                `QUARANTINED returns must be drawn from a QUARANTINE warehouse. Warehouse "${sourceWh.name}" is designated as ${sourceWh.warehouseType}.`,
              );
            }
          }

          // Financial snapshot calculations
          const unitCostNum = Number(unitCostDecimal);
          const discPctNum = Number(discPctDecimal);
          const taxPctNum = Number(taxPctDecimal);

          const grossLine = retQty * unitCostNum;
          const discAmount = Math.round(((grossLine * discPctNum) / 100) * 100) / 100;
          const taxable = grossLine - discAmount;
          const taxAmt = Math.round(((taxable * taxPctNum) / 100) * 100) / 100;
          const lineTotal = Math.round((taxable + taxAmt) * 100) / 100;

          returnSubtotal += grossLine;
          returnDiscountAmount += discAmount;
          returnTaxAmount += taxAmt;
          returnNetTotal += lineTotal;

          resolvedReturnLines.push({
            grnItemId: itemDto.grnItemId || null,
            productId,
            batchId,
            batchNumber,
            expiryDate,
            sourceWarehouseId: itemDto.sourceWarehouseId,
            returnedQuantity: retQty,
            bonusReturnedQuantity: bonusRetQty,
            totalReturnedQuantity: totalRetQty,
            stockCondition: itemDto.stockCondition,
            unitCost: unitCostDecimal,
            discountPercentage: discPctDecimal,
            discountAmount: new Prisma.Decimal(discAmount),
            taxPercentage: taxPctDecimal,
            taxAmount: new Prisma.Decimal(taxAmt),
            lineTotal: new Prisma.Decimal(lineTotal),
          });
        }

        returnSubtotal = Math.round(returnSubtotal * 100) / 100;
        returnDiscountAmount = Math.round(returnDiscountAmount * 100) / 100;
        returnTaxAmount = Math.round(returnTaxAmount * 100) / 100;
        returnNetTotal = Math.round(returnNetTotal * 100) / 100;

        // 4. Generate sequential return document number
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.PURCHASE_RETURN,
          branchId,
          tx,
        );
        const returnNumber = numberResult.documentNumber;

        // 5. Create PurchaseReturn Header strictly in DRAFT status
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            organizationId,
            branchId,
            supplierId: lockedSupplier.id,
            grnId: lockedGrn ? lockedGrn.id : null,
            returnNumber,
            challanNumber: null,
            rgaNumber: dto.rgaNumber || null,
            rgaDate: dto.rgaDate ? new Date(dto.rgaDate) : null,
            vendorCreditNoteNumber: dto.vendorCreditNoteNumber || null,
            returnDate: dto.returnDate ? new Date(dto.returnDate) : new Date(),
            status: PurchaseReturnStatus.DRAFT,
            reason: dto.reason,
            subtotal: new Prisma.Decimal(returnSubtotal),
            discountAmount: new Prisma.Decimal(returnDiscountAmount),
            taxAmount: new Prisma.Decimal(returnTaxAmount),
            netTotal: new Prisma.Decimal(returnNetTotal),
            notes: dto.notes || null,
            postedByUserId: userId || null,
          },
        });

        // 6. Create PurchaseReturn Items
        await tx.purchaseReturnItem.createMany({
          data: resolvedReturnLines.map((line) => ({
            ...line,
            purchaseReturnId: purchaseReturn.id,
          })),
        });

        // 7. Audit Log for DRAFT creation
        await this.audit.log({
          userId,
          action: 'CREATE_PURCHASE_RETURN_DRAFT',
          entity: 'PURCHASE_RETURN',
          entityId: purchaseReturn.id,
          details: {
            returnNumber,
            supplierId: lockedSupplier.id,
            supplierName: lockedSupplier.name,
            grnId: lockedGrn?.id,
            rgaNumber: dto.rgaNumber,
            netTotal: returnNetTotal,
            itemCount: resolvedReturnLines.length,
          },
        });

        return this.findByIdWithTx(tx, purchaseReturn.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Dispatches a DRAFT purchase return:
   * Deducts physical stock with StockMovementType.PURCHASE_RETURN (-) and generates Supplier Return Challan (SRCH-xxxxx).
   */
  async dispatchPurchaseReturn(id: string, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        const lockedReturns = await tx.$queryRaw<
          Array<{
            id: string;
            branch_id: string;
            supplier_id: string;
            return_number: string;
            status: string;
          }>
        >`
          SELECT id, branch_id, supplier_id, return_number, status
          FROM purchase_returns
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedReturns.length) {
          throw new NotFoundException(`Purchase return with ID "${id}" not found`);
        }

        const lockedReturn = lockedReturns[0];
        if (lockedReturn.status !== PurchaseReturnStatus.DRAFT) {
          throw new BadRequestException(
            `Cannot dispatch purchase return with status "${lockedReturn.status}". Only DRAFT returns can be dispatched.`,
          );
        }

        const items = await tx.purchaseReturnItem.findMany({
          where: { purchaseReturnId: lockedReturn.id },
          include: { sourceWarehouse: true, batch: true, product: true },
        });

        if (!items.length) {
          throw new BadRequestException('Purchase return contains no items to dispatch');
        }

        // 1. Verify physical inventory and create outbound stock movements
        for (const line of items) {
          const movements = await tx.stockMovement.findMany({
            where: {
              organizationId,
              warehouseId: line.sourceWarehouseId,
              batchId: line.batchId,
            },
            select: { quantity: true },
          });

          const currentWarehouseStock = movements.reduce((sum, m) => sum + m.quantity, 0);
          if (currentWarehouseStock < line.totalReturnedQuantity) {
            throw new BadRequestException(
              `Insufficient physical stock in warehouse "${line.sourceWarehouse.name}" to dispatch batch "${line.batchNumber}". Required: ${line.totalReturnedQuantity}, Available: ${currentWarehouseStock}.`,
            );
          }

          // Deduct physical stock
          await tx.stockMovement.create({
            data: {
              organizationId,
              branchId: lockedReturn.branch_id,
              warehouseId: line.sourceWarehouseId,
              productId: line.productId,
              batchId: line.batchId,
              movementType: StockMovementType.PURCHASE_RETURN,
              quantity: -line.totalReturnedQuantity, // Negative (-) deduction
              unitCost: line.unitCost,
              referenceType: 'PURCHASE_RETURN',
              referenceId: lockedReturn.id,
              notes: `Dispatched purchase return ${lockedReturn.return_number}`,
              createdByUserId: userId || null,
            },
          });
        }

        // 2. Generate sequential Supplier Return Challan number
        const challanNumberResult = await this.numbering.generateNextNumber(
          DocumentType.SUPPLIER_RETURN_CHALLAN,
          lockedReturn.branch_id,
          tx,
        );
        const challanNumber = challanNumberResult.documentNumber;

        // 3. Update PurchaseReturn status to DISPATCHED
        await tx.purchaseReturn.update({
          where: { id: lockedReturn.id },
          data: {
            status: PurchaseReturnStatus.DISPATCHED,
            challanNumber,
            dispatchedAt: new Date(),
            dispatchedByUserId: userId || null,
          },
        });

        // 4. Audit Log
        await this.audit.log({
          userId,
          action: 'DISPATCH_PURCHASE_RETURN',
          entity: 'PURCHASE_RETURN',
          entityId: lockedReturn.id,
          details: {
            returnNumber: lockedReturn.return_number,
            challanNumber,
          },
        });

        return this.findByIdWithTx(tx, lockedReturn.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Completes a DISPATCHED purchase return upon vendor confirmation/credit note:
   * Posts SupplierLedgerEntry (DEBIT_NOTE) and updates GRN balance if linked.
   */
  async completePurchaseReturn(
    id: string,
    dto?: { vendorCreditNoteNumber?: string },
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        const lockedReturns = await tx.$queryRaw<
          Array<{
            id: string;
            branch_id: string;
            supplier_id: string;
            grn_id: string | null;
            return_number: string;
            net_total: Prisma.Decimal;
            rga_number: string | null;
            status: string;
          }>
        >`
          SELECT id, branch_id, supplier_id, grn_id, return_number, net_total, rga_number, status
          FROM purchase_returns
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedReturns.length) {
          throw new NotFoundException(`Purchase return with ID "${id}" not found`);
        }

        const lockedReturn = lockedReturns[0];
        if (lockedReturn.status !== PurchaseReturnStatus.DISPATCHED) {
          throw new BadRequestException(
            `Cannot complete purchase return with status "${lockedReturn.status}". Only DISPATCHED returns can be completed.`,
          );
        }

        const returnNetTotal = Number(lockedReturn.net_total);

        // 1. Lock Supplier row
        const lockedSuppliers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string; is_active: boolean }>
        >`
          SELECT id, current_balance, name, is_active FROM suppliers
          WHERE id = ${lockedReturn.supplier_id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedSuppliers.length) {
          throw new NotFoundException('Supplier not found');
        }
        const lockedSupplier = lockedSuppliers[0];

        // 2. If GRN linked: lock GRN and update balance
        if (lockedReturn.grn_id) {
          const lockedGrns = await tx.$queryRaw<
            Array<{
              id: string;
              grn_number: string;
              net_total: Prisma.Decimal;
              paid_amount: Prisma.Decimal;
              balance_amount: Prisma.Decimal;
            }>
          >`
            SELECT id, grn_number, net_total, paid_amount, balance_amount
            FROM goods_receive_notes
            WHERE id = ${lockedReturn.grn_id} AND organization_id = ${organizationId}
            FOR UPDATE
          `;

          if (lockedGrns.length) {
            const lockedGrn = lockedGrns[0];
            const currentGrnBalance = Number(lockedGrn.balance_amount);
            const newGrnBalance = Math.max(
              0,
              Math.round((currentGrnBalance - returnNetTotal) * 100) / 100,
            );
            const newGrnPaid = Math.max(
              0,
              Math.round((Number(lockedGrn.net_total) - newGrnBalance) * 100) / 100,
            );

            await tx.goodsReceiveNote.update({
              where: { id: lockedGrn.id },
              data: {
                paidAmount: new Prisma.Decimal(newGrnPaid),
                balanceAmount: new Prisma.Decimal(newGrnBalance),
              },
            });
          }
        }

        // 3. Create Supplier Sub-Ledger Entry (DEBIT_NOTE reduces payable balance)
        const previousSupplierBalance = Number(lockedSupplier.current_balance);
        const newSupplierBalance =
          Math.round((previousSupplierBalance - returnNetTotal) * 100) / 100;

        await tx.supplierLedgerEntry.create({
          data: {
            organizationId,
            branchId: lockedReturn.branch_id,
            supplierId: lockedSupplier.id,
            grnId: lockedReturn.grn_id || null,
            purchaseReturnId: lockedReturn.id,
            entryType: SupplierLedgerEntryType.DEBIT_NOTE,
            referenceNumber: lockedReturn.return_number,
            debit: new Prisma.Decimal(returnNetTotal),
            credit: new Prisma.Decimal(0),
            runningBalance: new Prisma.Decimal(newSupplierBalance),
            notes: `Purchase return debit note ${lockedReturn.return_number}${
              lockedReturn.rga_number ? ` (RGA: ${lockedReturn.rga_number})` : ''
            }`,
            createdByUserId: userId || null,
          },
        });

        // 4. Update Supplier cached balance
        await tx.supplier.update({
          where: { id: lockedSupplier.id },
          data: {
            currentBalance: new Prisma.Decimal(newSupplierBalance),
          },
        });

        // 5. Update PurchaseReturn status to COMPLETED
        await tx.purchaseReturn.update({
          where: { id: lockedReturn.id },
          data: {
            status: PurchaseReturnStatus.COMPLETED,
            completedAt: new Date(),
            completedByUserId: userId || null,
            ...(dto?.vendorCreditNoteNumber
              ? { vendorCreditNoteNumber: dto.vendorCreditNoteNumber }
              : {}),
          },
        });

        // 6. Audit Log
        await this.audit.log({
          userId,
          action: 'COMPLETE_PURCHASE_RETURN',
          entity: 'PURCHASE_RETURN',
          entityId: lockedReturn.id,
          details: {
            returnNumber: lockedReturn.return_number,
            netTotal: returnNetTotal,
            vendorCreditNoteNumber: dto?.vendorCreditNoteNumber,
          },
        });

        return this.findByIdWithTx(tx, lockedReturn.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Cancels a Purchase Return with exact-state reversal:
   * - DRAFT: Marks CANCELLED (no stock or ledger effect).
   * - DISPATCHED: Re-injects stock with PURCHASE_RECEIPT (+) and marks CANCELLED.
   * - COMPLETED: Re-injects stock (+) and posts reversing credit note in supplier ledger (ADJUSTMENT).
   */
  async cancelPurchaseReturn(id: string, dto: CancelPurchaseReturnDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        const lockedReturns = await tx.$queryRaw<
          Array<{
            id: string;
            branch_id: string;
            supplier_id: string;
            grn_id: string | null;
            return_number: string;
            net_total: Prisma.Decimal;
            status: string;
          }>
        >`
          SELECT id, branch_id, supplier_id, grn_id, return_number, net_total, status
          FROM purchase_returns
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedReturns.length) {
          throw new NotFoundException(`Purchase return with ID "${id}" not found`);
        }

        const lockedReturn = lockedReturns[0];
        if (lockedReturn.status === PurchaseReturnStatus.CANCELLED) {
          throw new ConflictException(
            `Purchase return "${lockedReturn.return_number}" is already cancelled`,
          );
        }

        const items = await tx.purchaseReturnItem.findMany({
          where: { purchaseReturnId: lockedReturn.id },
        });

        // 1. Re-inject stock if physical deduction occurred (DISPATCHED or COMPLETED)
        if (
          lockedReturn.status === PurchaseReturnStatus.DISPATCHED ||
          lockedReturn.status === PurchaseReturnStatus.COMPLETED
        ) {
          for (const item of items) {
            await tx.stockMovement.create({
              data: {
                organizationId,
                branchId: lockedReturn.branch_id,
                warehouseId: item.sourceWarehouseId,
                productId: item.productId,
                batchId: item.batchId,
                movementType: StockMovementType.PURCHASE_RECEIPT,
                quantity: item.totalReturnedQuantity, // Positive (+) re-entry
                unitCost: item.unitCost,
                referenceType: 'PURCHASE_RETURN_CANCEL',
                referenceId: lockedReturn.id,
                notes: `Stock re-entry on cancellation of purchase return ${lockedReturn.return_number}`,
                createdByUserId: userId || null,
              },
            });
          }
        }

        // 2. Reverse Supplier Ledger if debit note was posted (COMPLETED)
        if (lockedReturn.status === PurchaseReturnStatus.COMPLETED) {
          const lockedSuppliers = await tx.$queryRaw<
            Array<{ id: string; current_balance: Prisma.Decimal; name: string }>
          >`
            SELECT id, current_balance, name
            FROM suppliers
            WHERE id = ${lockedReturn.supplier_id} AND organization_id = ${organizationId}
            FOR UPDATE
          `;

          if (!lockedSuppliers.length) {
            throw new NotFoundException('Supplier not found');
          }
          const lockedSupplier = lockedSuppliers[0];
          const returnNetTotal = Number(lockedReturn.net_total);
          const previousSupplierBalance = Number(lockedSupplier.current_balance);
          const newSupplierBalance =
            Math.round((previousSupplierBalance + returnNetTotal) * 100) / 100;

          await tx.supplierLedgerEntry.create({
            data: {
              organizationId,
              branchId: lockedReturn.branch_id,
              supplierId: lockedSupplier.id,
              grnId: lockedReturn.grn_id,
              purchaseReturnId: lockedReturn.id,
              entryType: SupplierLedgerEntryType.ADJUSTMENT,
              referenceNumber: lockedReturn.return_number,
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(returnNetTotal),
              runningBalance: new Prisma.Decimal(newSupplierBalance),
              notes: `Purchase return debit note ${lockedReturn.return_number} cancelled/voided: ${dto.cancellationReason}`,
              createdByUserId: userId || null,
            },
          });

          await tx.supplier.update({
            where: { id: lockedSupplier.id },
            data: {
              currentBalance: new Prisma.Decimal(newSupplierBalance),
            },
          });

          // Recalculate GRN balances if linked
          if (lockedReturn.grn_id) {
            const lockedGrns = await tx.$queryRaw<
              Array<{
                id: string;
                net_total: Prisma.Decimal;
                paid_amount: Prisma.Decimal;
                balance_amount: Prisma.Decimal;
              }>
            >`
              SELECT id, net_total, paid_amount, balance_amount
              FROM goods_receive_notes
              WHERE id = ${lockedReturn.grn_id} AND organization_id = ${organizationId}
              FOR UPDATE
            `;

            if (lockedGrns.length) {
              const grn = lockedGrns[0];
              const paymentAllocations = await tx.supplierPaymentAllocation.findMany({
                where: {
                  grnId: grn.id,
                  supplierPayment: { status: SupplierPaymentStatus.POSTED },
                },
              });
              const totalPaid = paymentAllocations.reduce(
                (sum, a) => sum + Number(a.amountAllocated),
                0,
              );

              const otherReturns = await tx.purchaseReturn.findMany({
                where: {
                  grnId: grn.id,
                  id: { not: lockedReturn.id },
                  status: PurchaseReturnStatus.COMPLETED,
                },
              });
              const otherReturnCredit = otherReturns.reduce(
                (sum, r) => sum + Number(r.netTotal),
                0,
              );

              const netTotal = Number(grn.net_total);
              const totalEffectiveCredits =
                Math.round((totalPaid + otherReturnCredit) * 100) / 100;
              const recalculatedBalance = Math.max(
                0,
                Math.round((netTotal - totalEffectiveCredits) * 100) / 100,
              );
              const recalculatedPaid = Math.max(
                0,
                Math.round((netTotal - recalculatedBalance) * 100) / 100,
              );

              await tx.goodsReceiveNote.update({
                where: { id: grn.id },
                data: {
                  paidAmount: new Prisma.Decimal(recalculatedPaid),
                  balanceAmount: new Prisma.Decimal(recalculatedBalance),
                },
              });
            }
          }
        }

        // 3. Mark PurchaseReturn as CANCELLED
        await tx.purchaseReturn.update({
          where: { id: lockedReturn.id },
          data: {
            status: PurchaseReturnStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledByUserId: userId || null,
            cancellationReason: dto.cancellationReason,
          },
        });

        // 4. Audit Log
        await this.audit.log({
          userId,
          action: 'CANCEL_PURCHASE_RETURN',
          entity: 'PURCHASE_RETURN',
          entityId: lockedReturn.id,
          details: {
            returnNumber: lockedReturn.return_number,
            cancellationReason: dto.cancellationReason,
          },
        });

        return this.findByIdWithTx(tx, lockedReturn.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Retrieves paginated purchase returns with filters and aggregates.
   */
  async findAll(query: QueryPurchaseReturnDto) {
    const organizationId = await this.getOrganizationId();
    const {
      search,
      supplierId,
      grnId,
      status,
      reason,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = query;

    const where: Prisma.PurchaseReturnWhereInput = {
      organizationId,
    };

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (grnId) {
      where.grnId = grnId;
    }

    if (status) {
      where.status = status;
    }

    if (reason) {
      where.reason = reason;
    }

    if (startDate || endDate) {
      where.returnDate = {};
      if (startDate) {
        where.returnDate.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.returnDate.lte = end;
      }
    }

    if (search) {
      where.OR = [
        { returnNumber: { contains: search, mode: 'insensitive' } },
        { challanNumber: { contains: search, mode: 'insensitive' } },
        { rgaNumber: { contains: search, mode: 'insensitive' } },
        { grn: { grnNumber: { contains: search, mode: 'insensitive' } } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { supplier: { code: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total, completedAggregates, dispatchedAggregates] = await Promise.all([
      this.prisma.purchaseReturn.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ returnDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              code: true,
              phone: true,
              currentBalance: true,
            },
          },
          grn: {
            select: {
              id: true,
              grnNumber: true,
              supplierInvoiceNumber: true,
              receivedDate: true,
            },
          },
          postedByUser: {
            select: { id: true, displayName: true, username: true },
          },
          dispatchedByUser: {
            select: { id: true, displayName: true, username: true },
          },
          completedByUser: {
            select: { id: true, displayName: true, username: true },
          },
          cancelledByUser: {
            select: { id: true, displayName: true, username: true },
          },
          _count: {
            select: { items: true },
          },
        },
      }),
      this.prisma.purchaseReturn.count({ where }),
      this.prisma.purchaseReturn.aggregate({
        where: { ...where, status: PurchaseReturnStatus.COMPLETED },
        _sum: { netTotal: true },
      }),
      this.prisma.purchaseReturn.aggregate({
        where: { ...where, status: PurchaseReturnStatus.DISPATCHED },
        _sum: { netTotal: true },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalCompletedReturn: completedAggregates._sum.netTotal
          ? Number(completedAggregates._sum.netTotal)
          : 0,
        totalDispatchedReturn: dispatchedAggregates._sum.netTotal
          ? Number(dispatchedAggregates._sum.netTotal)
          : 0,
      },
    };
  }

  /**
   * Retrieves full purchase return details by ID.
   */
  async findById(id: string) {
    const organizationId = await this.getOrganizationId();
    return this.findByIdWithTx(this.prisma, id, organizationId);
  }

  /**
   * Retrieves Supplier Return Challan print payload.
   */
  async getChallan(id: string) {
    const organizationId = await this.getOrganizationId();
    const purchaseReturn = await this.findByIdWithTx(this.prisma, id, organizationId);

    if (
      purchaseReturn.status !== PurchaseReturnStatus.DISPATCHED &&
      purchaseReturn.status !== PurchaseReturnStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `Supplier Return Challan is only available for DISPATCHED or COMPLETED returns. Current status: ${purchaseReturn.status}`,
      );
    }

    return purchaseReturn;
  }

  private async findByIdWithTx(
    tx: Prisma.TransactionClient | PrismaService,
    id: string,
    organizationId: string,
  ) {
    const purchaseReturn = await tx.purchaseReturn.findFirst({
      where: { id, organizationId },
      include: {
        supplier: true,
        branch: { select: { id: true, name: true, code: true } },
        grn: {
          select: {
            id: true,
            grnNumber: true,
            supplierInvoiceNumber: true,
            receivedDate: true,
            netTotal: true,
            paidAmount: true,
            balanceAmount: true,
          },
        },
        postedByUser: { select: { id: true, displayName: true, username: true } },
        dispatchedByUser: { select: { id: true, displayName: true, username: true } },
        completedByUser: { select: { id: true, displayName: true, username: true } },
        cancelledByUser: { select: { id: true, displayName: true, username: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
                packSize: true,
                unit: { select: { symbol: true, name: true } },
              },
            },
            batch: {
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                purchaseCost: true,
                tradePrice: true,
                retailPrice: true,
              },
            },
            sourceWarehouse: {
              select: {
                id: true,
                name: true,
                code: true,
                warehouseType: true,
              },
            },
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!purchaseReturn) {
      throw new NotFoundException(`Purchase return with ID "${id}" not found`);
    }

    return purchaseReturn;
  }
}
