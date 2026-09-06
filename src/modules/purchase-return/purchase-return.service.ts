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
          where: { status: PurchaseReturnStatus.POSTED },
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

    // Cumulative returned quantities per GRN item line
    const returnedMap: Record<string, { billed: number; bonus: number }> = {};
    for (const ret of grn.purchaseReturns) {
      for (const item of ret.items) {
        if (!returnedMap[item.grnItemId]) {
          returnedMap[item.grnItemId] = { billed: 0, bonus: 0 };
        }
        returnedMap[item.grnItemId].billed += item.returnedQuantity;
        returnedMap[item.grnItemId].bonus += item.bonusReturnedQuantity;
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
   * Creates and posts a Purchase Return document with exact-warehouse physical deduction and supplier ledger debit note.
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
      throw new BadRequestException('At least one line item must have a return quantity greater than 0');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Lock GRN row with FOR UPDATE
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

        const lockedGrn = lockedGrns[0];
        if (lockedGrn.status !== GrnStatus.POSTED) {
          throw new BadRequestException(
            `Cannot issue a purchase return against GRN "${lockedGrn.grn_number}" with status ${lockedGrn.status}`,
          );
        }

        // 2. Lock Supplier row with FOR UPDATE
        const lockedSuppliers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string; is_active: boolean }>
        >`
          SELECT id, current_balance, name, is_active FROM suppliers
          WHERE id = ${lockedGrn.supplier_id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedSuppliers.length) {
          throw new NotFoundException('Supplier associated with GRN not found');
        }
        const lockedSupplier = lockedSuppliers[0];
        if (!lockedSupplier.is_active) {
          throw new BadRequestException(`Supplier "${lockedSupplier.name}" is deactivated`);
        }

        // 3. Fetch GRN line items
        const grnItems = await tx.goodsReceiveNoteItem.findMany({
          where: { grnId: lockedGrn.id },
          include: {
            batch: true,
            product: true,
          },
        });
        const grnItemMap = new Map(grnItems.map((item) => [item.id, item]));

        // 4. Fetch prior returns on this GRN to validate cumulative limits
        const priorReturns = await tx.purchaseReturn.findMany({
          where: { grnId: lockedGrn.id, status: PurchaseReturnStatus.POSTED },
          include: { items: true },
        });

        const returnedCumulativeMap: Record<string, { billed: number; bonus: number }> = {};
        for (const ret of priorReturns) {
          for (const item of ret.items) {
            if (!returnedCumulativeMap[item.grnItemId]) {
              returnedCumulativeMap[item.grnItemId] = { billed: 0, bonus: 0 };
            }
            returnedCumulativeMap[item.grnItemId].billed += item.returnedQuantity;
            returnedCumulativeMap[item.grnItemId].bonus += item.bonusReturnedQuantity;
          }
        }

        // 5. Validate and calculate return lines
        let returnSubtotal = 0;
        let returnDiscountAmount = 0;
        let returnTaxAmount = 0;
        let returnNetTotal = 0;

        const resolvedReturnLines: Array<{
          grnItemId: string;
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

        for (const itemDto of dto.items) {
          const retQty = itemDto.returnedQuantity || 0;
          const bonusRetQty = itemDto.bonusReturnedQuantity || 0;
          const totalRetQty = retQty + bonusRetQty;

          if (totalRetQty <= 0) {
            continue; // Skip lines with 0 quantity
          }

          const grnItem = grnItemMap.get(itemDto.grnItemId);
          if (!grnItem) {
            throw new NotFoundException(`GRN Item "${itemDto.grnItemId}" not found in this GRN`);
          }

          // A. Cumulative Quantity Check
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

          // B. Verify warehouse & condition
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

          // Warehouse type isolation rules
          if (itemDto.stockCondition === ReturnedStockCondition.SALEABLE) {
            if (sourceWh.warehouseType !== WarehouseType.STANDARD) {
              throw new BadRequestException(
                `SALEABLE returns must be drawn from a STANDARD warehouse. Warehouse "${sourceWh.name}" is designated as ${sourceWh.warehouseType}.`,
              );
            }

            // Inactive / Expired batch rule
            const isExpired = new Date(grnItem.expiryDate) <= new Date();
            const isInactive = grnItem.batch?.status !== 'ACTIVE';
            if (isExpired || isInactive) {
              throw new BadRequestException(
                `Expired or inactive batch "${grnItem.batchNumber}" cannot be returned as SALEABLE. Condition must be set to QUARANTINED.`,
              );
            }
          } else if (itemDto.stockCondition === ReturnedStockCondition.QUARANTINED) {
            if (sourceWh.warehouseType !== WarehouseType.QUARANTINE) {
              throw new BadRequestException(
                `QUARANTINED returns must be drawn from a QUARANTINE warehouse. Warehouse "${sourceWh.name}" is designated as ${sourceWh.warehouseType}.`,
              );
            }
          }

          // C. Physical Inventory Stock Availability Check in exact warehouse
          if (!grnItem.batchId) {
            throw new BadRequestException(`GRN line item ${grnItem.id} missing assigned batch`);
          }

          const movements = await tx.stockMovement.findMany({
            where: {
              organizationId,
              warehouseId: itemDto.sourceWarehouseId,
              batchId: grnItem.batchId,
            },
            select: { quantity: true },
          });

          const currentWarehouseStock = movements.reduce((sum, m) => sum + m.quantity, 0);
          if (currentWarehouseStock < totalRetQty) {
            throw new BadRequestException(
              `Insufficient physical stock in warehouse "${sourceWh.name}" to return batch "${grnItem.batchNumber}". Required: ${totalRetQty}, Available in warehouse: ${currentWarehouseStock}.`,
            );
          }

          // D. Financial Calculation
          const unitCostNum = Number(grnItem.unitCost);
          const grossLine = retQty * unitCostNum;
          const discPct = Number(grnItem.discountPercentage);
          const taxPct = Number(grnItem.taxPercentage);

          const discAmount = Math.round(((grossLine * discPct) / 100) * 100) / 100;
          const taxable = grossLine - discAmount;
          const taxAmt = Math.round(((taxable * taxPct) / 100) * 100) / 100;
          const lineTotal = Math.round((taxable + taxAmt) * 100) / 100;

          returnSubtotal += grossLine;
          returnDiscountAmount += discAmount;
          returnTaxAmount += taxAmt;
          returnNetTotal += lineTotal;

          resolvedReturnLines.push({
            grnItemId: grnItem.id,
            productId: grnItem.productId,
            batchId: grnItem.batchId,
            batchNumber: grnItem.batchNumber,
            expiryDate: grnItem.expiryDate,
            sourceWarehouseId: itemDto.sourceWarehouseId,
            returnedQuantity: retQty,
            bonusReturnedQuantity: bonusRetQty,
            totalReturnedQuantity: totalRetQty,
            stockCondition: itemDto.stockCondition,
            unitCost: grnItem.unitCost,
            discountPercentage: grnItem.discountPercentage,
            discountAmount: new Prisma.Decimal(discAmount),
            taxPercentage: grnItem.taxPercentage,
            taxAmount: new Prisma.Decimal(taxAmt),
            lineTotal: new Prisma.Decimal(lineTotal),
          });
        }

        returnSubtotal = Math.round(returnSubtotal * 100) / 100;
        returnDiscountAmount = Math.round(returnDiscountAmount * 100) / 100;
        returnTaxAmount = Math.round(returnTaxAmount * 100) / 100;
        returnNetTotal = Math.round(returnNetTotal * 100) / 100;

        // 6. Generate sequential return document number
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.PURCHASE_RETURN,
          branchId,
        );
        const returnNumber = numberResult.documentNumber;

        // 7. Create PurchaseReturn Header
        const purchaseReturn = await tx.purchaseReturn.create({
          data: {
            organizationId,
            branchId,
            supplierId: lockedSupplier.id,
            grnId: lockedGrn.id,
            returnNumber,
            returnDate: dto.returnDate ? new Date(dto.returnDate) : new Date(),
            status: PurchaseReturnStatus.POSTED,
            reason: dto.reason,
            subtotal: new Prisma.Decimal(returnSubtotal),
            discountAmount: new Prisma.Decimal(returnDiscountAmount),
            taxAmount: new Prisma.Decimal(returnTaxAmount),
            netTotal: new Prisma.Decimal(returnNetTotal),
            notes: dto.notes || null,
            postedByUserId: userId || null,
          },
        });

        // 8. Create PurchaseReturn Items
        await tx.purchaseReturnItem.createMany({
          data: resolvedReturnLines.map((line) => ({
            ...line,
            purchaseReturnId: purchaseReturn.id,
          })),
        });

        // 9. Create Physical Stock Deductions (StockMovement OUT: PURCHASE_RETURN)
        for (const line of resolvedReturnLines) {
          await tx.stockMovement.create({
            data: {
              organizationId,
              branchId,
              warehouseId: line.sourceWarehouseId,
              productId: line.productId,
              batchId: line.batchId,
              movementType: StockMovementType.PURCHASE_RETURN,
              quantity: -line.totalReturnedQuantity, // Negative (-) deduction
              unitCost: line.unitCost,
              referenceType: 'PURCHASE_RETURN',
              referenceId: purchaseReturn.id,
              notes: `Purchase return debit note ${returnNumber} to supplier ${lockedSupplier.name}`,
              createdByUserId: userId || null,
            },
          });
        }

        // 10. Update GRN Settlement
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

        // 11. Supplier Sub-Ledger Entry (Debit reduces payable)
        const previousSupplierBalance = Number(lockedSupplier.current_balance);
        const newSupplierBalance = Math.round((previousSupplierBalance - returnNetTotal) * 100) / 100;

        await tx.supplierLedgerEntry.create({
          data: {
            organizationId,
            branchId,
            supplierId: lockedSupplier.id,
            grnId: lockedGrn.id,
            purchaseReturnId: purchaseReturn.id,
            entryType: SupplierLedgerEntryType.DEBIT_NOTE,
            referenceNumber: returnNumber,
            debit: new Prisma.Decimal(returnNetTotal),
            credit: new Prisma.Decimal(0),
            runningBalance: new Prisma.Decimal(newSupplierBalance),
            notes: `Purchase return debit note ${returnNumber} against GRN ${lockedGrn.grn_number} (${dto.reason})`,
            createdByUserId: userId || null,
          },
        });

        // Update Supplier cached balance
        await tx.supplier.update({
          where: { id: lockedSupplier.id },
          data: {
            currentBalance: new Prisma.Decimal(newSupplierBalance),
          },
        });

        // 12. Audit Log
        await this.audit.log({
          userId,
          action: 'CREATE_PURCHASE_RETURN',
          entity: 'PURCHASE_RETURN',
          entityId: purchaseReturn.id,
          details: {
            returnNumber,
            grnNumber: lockedGrn.grn_number,
            netTotal: returnNetTotal,
            reason: dto.reason,
            itemsCount: resolvedReturnLines.length,
          },
        });

        return this.findByIdWithTx(tx, purchaseReturn.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Cancels/voids a posted Purchase Return document with stock re-entry and ground-truth GRN settlement recalculation.
   */
  async cancelPurchaseReturn(id: string, dto: CancelPurchaseReturnDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Fetch return with items and source warehouses
        const purchaseReturn = await tx.purchaseReturn.findFirst({
          where: { id, organizationId },
          include: {
            items: {
              include: {
                sourceWarehouse: true,
                batch: true,
                product: true,
              },
            },
            grn: true,
            supplier: true,
          },
        });

        if (!purchaseReturn) {
          throw new NotFoundException(`Purchase return with ID "${id}" not found`);
        }

        if (purchaseReturn.status === PurchaseReturnStatus.CANCELLED) {
          throw new ConflictException(
            `Purchase return "${purchaseReturn.returnNumber}" is already cancelled`,
          );
        }

        // 2. Re-inject stock back into inventory (StockMovement IN: PURCHASE_RECEIPT)
        for (const item of purchaseReturn.items) {
          await tx.stockMovement.create({
            data: {
              organizationId,
              branchId: purchaseReturn.branchId,
              warehouseId: item.sourceWarehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType: StockMovementType.PURCHASE_RECEIPT,
              quantity: item.totalReturnedQuantity, // Positive (+) re-entry
              unitCost: item.unitCost,
              referenceType: 'PURCHASE_RETURN_CANCEL',
              referenceId: purchaseReturn.id,
              notes: `Compensating stock re-entry on cancellation of purchase return ${purchaseReturn.returnNumber}`,
              createdByUserId: userId || null,
            },
          });
        }

        // 3. Lock Supplier row for update
        const lockedSuppliers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string }>
        >`
          SELECT id, current_balance, name
          FROM suppliers
          WHERE id = ${purchaseReturn.supplierId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedSuppliers.length) {
          throw new NotFoundException('Supplier associated with purchase return not found');
        }
        const lockedSupplier = lockedSuppliers[0];

        // 4. Lock GRN and recalculate ground-truth settlement balances
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
          WHERE id = ${purchaseReturn.grnId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (lockedGrns.length > 0) {
          const grn = lockedGrns[0];

          // A. Fetch active supplier payment allocations
          const paymentAllocations = await tx.supplierPaymentAllocation.findMany({
            where: {
              grnId: grn.id,
              supplierPayment: {
                status: SupplierPaymentStatus.POSTED,
              },
            },
          });
          const totalPaid = paymentAllocations.reduce(
            (sum, a) => sum + Number(a.amountAllocated),
            0,
          );

          // B. Fetch other active purchase returns (excluding this cancelled one)
          const otherReturns = await tx.purchaseReturn.findMany({
            where: {
              grnId: grn.id,
              id: { not: purchaseReturn.id },
              status: PurchaseReturnStatus.POSTED,
            },
          });
          const otherReturnCredit = otherReturns.reduce(
            (sum, r) => sum + Number(r.netTotal),
            0,
          );

          const netTotal = Number(grn.net_total);
          const totalEffectiveCredits = Math.round((totalPaid + otherReturnCredit) * 100) / 100;

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

        // 5. Mark PurchaseReturn as CANCELLED
        await tx.purchaseReturn.update({
          where: { id: purchaseReturn.id },
          data: {
            status: PurchaseReturnStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledByUserId: userId || null,
            cancellationReason: dto.cancellationReason,
          },
        });

        // 6. Supplier Sub-Ledger Entry (Reversal: Credit increases payable back)
        const previousSupplierBalance = Number(lockedSupplier.current_balance);
        const returnNetTotal = Number(purchaseReturn.netTotal);
        const newSupplierBalance = Math.round((previousSupplierBalance + returnNetTotal) * 100) / 100;

        await tx.supplierLedgerEntry.create({
          data: {
            organizationId,
            branchId: purchaseReturn.branchId,
            supplierId: lockedSupplier.id,
            grnId: purchaseReturn.grnId,
            purchaseReturnId: purchaseReturn.id,
            entryType: SupplierLedgerEntryType.ADJUSTMENT,
            referenceNumber: purchaseReturn.returnNumber,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(returnNetTotal),
            runningBalance: new Prisma.Decimal(newSupplierBalance),
            notes: `Purchase return debit note ${purchaseReturn.returnNumber} cancelled/voided: ${dto.cancellationReason}`,
            createdByUserId: userId || null,
          },
        });

        // Update Supplier cached balance
        await tx.supplier.update({
          where: { id: lockedSupplier.id },
          data: {
            currentBalance: new Prisma.Decimal(newSupplierBalance),
          },
        });

        // 7. Audit Log
        await this.audit.log({
          userId,
          action: 'CANCEL_PURCHASE_RETURN',
          entity: 'PURCHASE_RETURN',
          entityId: purchaseReturn.id,
          details: {
            returnNumber: purchaseReturn.returnNumber,
            grnNumber: purchaseReturn.grn?.grnNumber,
            netTotal: returnNetTotal,
            cancellationReason: dto.cancellationReason,
          },
        });

        return this.findByIdWithTx(tx, purchaseReturn.id, organizationId);
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
        { grn: { grnNumber: { contains: search, mode: 'insensitive' } } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { supplier: { code: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total, aggregates] = await Promise.all([
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
        where: { ...where, status: PurchaseReturnStatus.POSTED },
        _sum: {
          netTotal: true,
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalNetReturn: aggregates._sum.netTotal ? Number(aggregates._sum.netTotal) : 0,
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
