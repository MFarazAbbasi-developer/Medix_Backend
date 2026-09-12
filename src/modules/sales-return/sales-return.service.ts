import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { QuerySalesReturnDto } from './dto/query-sales-return.dto';
import { CancelSalesReturnDto } from './dto/cancel-sales-return.dto';
import {
  Prisma,
  DocumentType,
  SalesReturnStatus,
  SalesInvoiceStatus,
  CustomerLedgerEntryType,
  StockMovementType,
  ReturnedStockCondition,
  ReturnStockDisposition,
  ReturnRefundMode,
  TillSessionStatus,
} from '@prisma/client';

@Injectable()
export class SalesReturnService {
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
   * Retrieves returnable line items and settlement limits for a posted invoice.
   */
  async getReturnableInvoice(invoiceId: string) {
    const organizationId = await this.getOrganizationId();

    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, organizationId },
      include: {
        customer: true,
        branch: {
          select: { id: true, name: true, code: true },
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
        salesReturns: {
          where: { status: SalesReturnStatus.POSTED },
          include: { items: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Sales invoice with ID "${invoiceId}" not found`);
    }

    if (invoice.status !== SalesInvoiceStatus.POSTED) {
      throw new BadRequestException(
        `Cannot issue a sales return against invoice with status "${invoice.status}"`,
      );
    }

    // Cumulative returned quantities per invoice line
    const returnedMap: Record<string, { billed: number; bonus: number }> = {};
    for (const ret of invoice.salesReturns) {
      for (const item of ret.items) {
        if (!returnedMap[item.salesInvoiceItemId]) {
          returnedMap[item.salesInvoiceItemId] = { billed: 0, bonus: 0 };
        }
        returnedMap[item.salesInvoiceItemId].billed += item.returnedQuantity;
        returnedMap[item.salesInvoiceItemId].bonus += item.bonusReturnedQuantity;
      }
    }

    const priorRefunds = invoice.salesReturns.reduce(
      (sum, r) => sum + Number(r.refundAmount),
      0,
    );
    const maxRefundableAmount = Math.max(0, Number(invoice.paidAmount) - priorRefunds);

    const returnableItems = invoice.items.map((item) => {
      const prior = returnedMap[item.id] || { billed: 0, bonus: 0 };
      const availableBilled = Math.max(0, item.billedQuantity - prior.billed);
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
        billedQuantity: item.billedQuantity,
        bonusQuantity: item.bonusQuantity,
        totalQuantity: item.totalQuantity,
        priorReturnedBilled: prior.billed,
        priorReturnedBonus: prior.bonus,
        availableBilled,
        availableBonus,
        unitPrice: Number(item.unitPrice),
        discountPercentage: Number(item.discountPercentage),
        taxPercentage: Number(item.taxPercentage),
        unitCost: Number(item.unitCost),
        canReturnAsSaleable,
        isExpired,
      };
    });

    return {
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        invoiceDate: invoice.invoiceDate,
        customerId: invoice.customerId,
        customerName: invoice.customer.name,
        customerCode: invoice.customer.code,
        customerBalance: Number(invoice.customer.currentBalance),
        branchId: invoice.branchId,
        warehouseId: invoice.warehouseId,
        netTotal: Number(invoice.netTotal),
        paidAmount: Number(invoice.paidAmount),
        balanceAmount: Number(invoice.balanceAmount),
        priorRefunds,
        maxRefundableAmount,
      },
      items: returnableItems,
    };
  }

  /**
   * Creates and posts a Sales Return document with condition-based warehouse routing,
   * stock movement restoration, COGS gross profit reversal, and settlement recalculation.
   */
  async createSalesReturn(dto: CreateSalesReturnDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sales return must include at least one returned item');
    }

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Lock invoice row with FOR UPDATE
        const lockedInvoices = await tx.$queryRaw<
          Array<{
            id: string;
            branch_id: string;
            customer_id: string;
            invoice_number: string;
            net_total: Prisma.Decimal;
            paid_amount: Prisma.Decimal;
            balance_amount: Prisma.Decimal;
            status: string;
          }>
        >`
          SELECT id, branch_id, customer_id, invoice_number, net_total, paid_amount, balance_amount, status
          FROM sales_invoices
          WHERE id = ${dto.salesInvoiceId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedInvoices.length) {
          throw new NotFoundException(`Sales invoice with ID "${dto.salesInvoiceId}" not found`);
        }

        const lockedInvoice = lockedInvoices[0];
        if (lockedInvoice.status !== SalesInvoiceStatus.POSTED) {
          throw new BadRequestException(
            `Cannot issue a sales return against invoice "${lockedInvoice.invoice_number}" with status "${lockedInvoice.status}"`,
          );
        }

        // 2. Lock customer row with FOR UPDATE
        const lockedCustomers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string; is_active: boolean }>
        >`
          SELECT id, current_balance, name, is_active
          FROM customers
          WHERE id = ${lockedInvoice.customer_id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedCustomers.length) {
          throw new NotFoundException(`Customer associated with invoice not found`);
        }
        const lockedCustomer = lockedCustomers[0];
        if (!lockedCustomer.is_active) {
          throw new BadRequestException(`Customer "${lockedCustomer.name}" is deactivated`);
        }

        // 3. Fetch invoice items and destination warehouses
        const invoiceItems = await tx.salesInvoiceItem.findMany({
          where: { salesInvoiceId: lockedInvoice.id },
          include: {
            batch: true,
            product: true,
          },
        });
        const invoiceItemMap = new Map(invoiceItems.map((i) => [i.id, i]));

        // Fetch prior active returns
        const priorReturns = await tx.salesReturn.findMany({
          where: {
            salesInvoiceId: lockedInvoice.id,
            status: SalesReturnStatus.POSTED,
          },
          include: { items: true },
        });

        const returnedMap: Record<string, { billed: number; bonus: number }> = {};
        for (const ret of priorReturns) {
          for (const item of ret.items) {
            if (!returnedMap[item.salesInvoiceItemId]) {
              returnedMap[item.salesInvoiceItemId] = { billed: 0, bonus: 0 };
            }
            returnedMap[item.salesInvoiceItemId].billed += item.returnedQuantity;
            returnedMap[item.salesInvoiceItemId].bonus += item.bonusReturnedQuantity;
          }
        }

        const priorRefunds = priorReturns.reduce(
          (sum, r) => sum + Number(r.refundAmount),
          0,
        );

        // Fetch destination warehouses
        const destinationWarehouseIds = [...new Set(dto.items.map((i) => i.destinationWarehouseId))];
        const warehouses = await tx.warehouse.findMany({
          where: {
            id: { in: destinationWarehouseIds },
            organizationId,
          },
        });
        const warehouseMap = new Map(warehouses.map((w) => [w.id, w]));

        const now = new Date();

        // 4. Validate return lines and compute commercials
        let returnSubtotal = 0;
        let returnDiscount = 0;
        let returnTax = 0;
        let returnNetTotal = 0;
        let returnTotalCost = 0;
        let returnGrossProfit = 0;

        const resolvedReturnLines: Array<{
          salesInvoiceItemId: string;
          productId: string;
          batchId: string;
          batchNumber: string;
          expiryDate: Date;
          destinationWarehouseId: string;
          returnedQuantity: number;
          bonusReturnedQuantity: number;
          totalReturnedQuantity: number;
          stockCondition: ReturnedStockCondition;
          disposition: ReturnStockDisposition;
          unitCost: number;
          unitPrice: number;
          discountPercentage: number;
          discountAmount: number;
          taxPercentage: number;
          taxAmount: number;
          lineTotal: number;
          lineCost: number;
          lineProfit: number;
        }> = [];

        for (const lineDto of dto.items) {
          const invItem = invoiceItemMap.get(lineDto.salesInvoiceItemId);
          if (!invItem) {
            throw new NotFoundException(
              `Invoice item with ID "${lineDto.salesInvoiceItemId}" does not belong to invoice "${lockedInvoice.invoice_number}"`,
            );
          }

          const prior = returnedMap[invItem.id] || { billed: 0, bonus: 0 };
          const bonusQty = lineDto.bonusReturnedQuantity || 0;

          if (lineDto.returnedQuantity <= 0) {
            throw new BadRequestException('Returned billed quantity must be greater than 0');
          }

          if (prior.billed + lineDto.returnedQuantity > invItem.billedQuantity) {
            throw new BadRequestException(
              `Returned quantity (${lineDto.returnedQuantity}) exceeds remaining returnable billed quantity (${invItem.billedQuantity - prior.billed}) for product "${invItem.product.name}"`,
            );
          }

          if (prior.bonus + bonusQty > invItem.bonusQuantity) {
            throw new BadRequestException(
              `Returned bonus quantity (${bonusQty}) exceeds remaining returnable bonus quantity (${invItem.bonusQuantity - prior.bonus}) for product "${invItem.product.name}"`,
            );
          }

          const destWarehouse = warehouseMap.get(lineDto.destinationWarehouseId);
          if (!destWarehouse) {
            throw new NotFoundException(
              `Destination warehouse "${lineDto.destinationWarehouseId}" not found`,
            );
          }

          // Resolve disposition & condition
          const disposition = lineDto.disposition || (
            lineDto.stockCondition === ReturnedStockCondition.QUARANTINED
              ? ReturnStockDisposition.QUARANTINE
              : ReturnStockDisposition.RESTOCK_SALEABLE
          );

          const stockCondition = disposition === ReturnStockDisposition.RESTOCK_SALEABLE
            ? ReturnedStockCondition.SALEABLE
            : ReturnedStockCondition.QUARANTINED;

          // Invariant: RESTOCK_SALEABLE -> STANDARD warehouse (active, non-expired batch)
          if (disposition === ReturnStockDisposition.RESTOCK_SALEABLE) {
            if (destWarehouse.warehouseType !== 'STANDARD') {
              throw new BadRequestException(
                `Stock with disposition RESTOCK_SALEABLE must be restocked into a STANDARD warehouse. Selected warehouse "${destWarehouse.name}" is of type ${destWarehouse.warehouseType}`,
              );
            }

            const isExpired = new Date(invItem.expiryDate) <= now;
            const isBatchActive = invItem.batch?.status === 'ACTIVE';
            if (isExpired || !isBatchActive) {
              throw new BadRequestException(
                `Batch "${invItem.batchNumber}" is expired, recalled, or inactive and CANNOT be returned as RESTOCK_SALEABLE. Disposition must be set to QUARANTINE or RETURN_TO_SUPPLIER.`,
              );
            }
          } else if (
            disposition === ReturnStockDisposition.QUARANTINE ||
            disposition === ReturnStockDisposition.RETURN_TO_SUPPLIER
          ) {
            if (destWarehouse.warehouseType !== 'QUARANTINE') {
              throw new BadRequestException(
                `Stock with disposition "${disposition}" must be restocked into a QUARANTINE warehouse. Selected warehouse "${destWarehouse.name}" is of type ${destWarehouse.warehouseType}`,
              );
            }
          }

          // Commercial Line Calculations
          const unitPrice = Number(invItem.unitPrice);
          const discPct = Number(invItem.discountPercentage);
          const taxPct = Number(invItem.taxPercentage);
          const unitCost = Number(invItem.unitCost);

          const totalReturnedQty = lineDto.returnedQuantity + bonusQty;
          const lineGross = Math.round(lineDto.returnedQuantity * unitPrice * 100) / 100;
          const lineDisc = Math.round(lineGross * (discPct / 100) * 100) / 100;
          const lineTaxable = Math.round((lineGross - lineDisc) * 100) / 100;
          const lineTax = Math.round(lineTaxable * (taxPct / 100) * 100) / 100;
          const lineTotal = Math.round((lineTaxable + lineTax) * 100) / 100;
          const lineCost = Math.round(totalReturnedQty * unitCost * 100) / 100;
          const lineProfit = Math.round((lineTotal - lineCost) * 100) / 100;

          returnSubtotal += lineGross;
          returnDiscount += lineDisc;
          returnTax += lineTax;
          returnNetTotal += lineTotal;
          returnTotalCost += lineCost;
          returnGrossProfit += lineProfit;

          resolvedReturnLines.push({
            salesInvoiceItemId: invItem.id,
            productId: invItem.productId,
            batchId: invItem.batchId,
            batchNumber: invItem.batchNumber,
            expiryDate: invItem.expiryDate,
            destinationWarehouseId: destWarehouse.id,
            returnedQuantity: lineDto.returnedQuantity,
            bonusReturnedQuantity: bonusQty,
            totalReturnedQuantity: totalReturnedQty,
            stockCondition,
            disposition,
            unitCost,
            unitPrice,
            discountPercentage: discPct,
            discountAmount: lineDisc,
            taxPercentage: taxPct,
            taxAmount: lineTax,
            lineTotal,
            lineCost,
            lineProfit,
          });
        }

        // Round summary totals
        returnSubtotal = Math.round(returnSubtotal * 100) / 100;
        returnDiscount = Math.round(returnDiscount * 100) / 100;
        returnTax = Math.round(returnTax * 100) / 100;
        returnNetTotal = Math.round(returnNetTotal * 100) / 100;
        returnTotalCost = Math.round(returnTotalCost * 100) / 100;
        returnGrossProfit = Math.round(returnGrossProfit * 100) / 100;

        // 5. Immediate Refund Restriction Invariant
        const maxRefundableAmount = Math.max(
          0,
          Math.round((Number(lockedInvoice.paid_amount) - priorRefunds) * 100) / 100,
        );

        let actualRefundAmount = 0;
        if (
          dto.refundMode === ReturnRefundMode.CASH_REFUND ||
          dto.refundMode === ReturnRefundMode.BANK_TRANSFER
        ) {
          const requestedRefund =
            dto.refundAmount !== undefined ? Number(dto.refundAmount) : returnNetTotal;

          if (requestedRefund <= 0) {
            throw new BadRequestException(
              'Refund payout amount must be greater than zero for cash/bank refund mode',
            );
          }

          if (requestedRefund > maxRefundableAmount + 0.001) {
            throw new BadRequestException(
              `Immediate refund of Rs. ${requestedRefund.toFixed(2)} exceeds total paid refundable amount (Rs. ${maxRefundableAmount.toFixed(2)}) for invoice "${lockedInvoice.invoice_number}". An unpaid or partially unpaid invoice cannot be refunded in excess of actual tender received.`,
            );
          }

          if (requestedRefund > returnNetTotal + 0.001) {
            throw new BadRequestException(
              `Refund amount (Rs. ${requestedRefund.toFixed(2)}) cannot exceed the return net total (Rs. ${returnNetTotal.toFixed(2)})`,
            );
          }

          actualRefundAmount = Math.round(requestedRefund * 100) / 100;
        }

        // 6. Generate sequential Return Number (DocumentType.SALES_RETURN)
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.SALES_RETURN,
          branchId,
          tx,
        );
        const returnNumber = numberResult.documentNumber;

        // 6b. Enforce active OPEN till session for physical CASH refunds
        let activeTillSessionId: string | null = null;
        if (
          dto.refundMode === ReturnRefundMode.CASH_REFUND &&
          actualRefundAmount > 0
        ) {
          if (!userId) {
            throw new BadRequestException(
              'Cashier user identification is required to disburse physical cash refunds.',
            );
          }

          const activeSession = await tx.tillSession.findFirst({
            where: {
              organizationId,
              branchId,
              userId,
              status: TillSessionStatus.OPEN,
            },
          });

          if (!activeSession) {
            throw new BadRequestException(
              'An active open cash till session is required to disburse physical cash refunds. Please open a till session first.',
            );
          }

          activeTillSessionId = activeSession.id;
        }

        // 7. Create SalesReturn Header
        const salesReturn = await tx.salesReturn.create({
          data: {
            organizationId,
            branchId,
            customerId: lockedCustomer.id,
            salesInvoiceId: lockedInvoice.id,
            tillSessionId: activeTillSessionId,
            returnNumber,
            returnDate: dto.returnDate ? new Date(dto.returnDate) : new Date(),
            status: SalesReturnStatus.POSTED,
            reason: dto.reason,
            refundMode: dto.refundMode,
            refundAmount: new Prisma.Decimal(actualRefundAmount),
            subtotal: new Prisma.Decimal(returnSubtotal),
            discountAmount: new Prisma.Decimal(returnDiscount),
            taxAmount: new Prisma.Decimal(returnTax),
            netTotal: new Prisma.Decimal(returnNetTotal),
            totalCostPrice: new Prisma.Decimal(returnTotalCost),
            grossProfit: new Prisma.Decimal(returnGrossProfit),
            notes: dto.notes || null,
            postedByUserId: userId || null,
          },
        });

        // 8. Create SalesReturnItem Lines & Immutable Stock Movements
        for (const line of resolvedReturnLines) {
          await tx.salesReturnItem.create({
            data: {
              salesReturnId: salesReturn.id,
              salesInvoiceItemId: line.salesInvoiceItemId,
              productId: line.productId,
              batchId: line.batchId,
              batchNumber: line.batchNumber,
              expiryDate: line.expiryDate,
              destinationWarehouseId: line.destinationWarehouseId,
              returnedQuantity: line.returnedQuantity,
              bonusReturnedQuantity: line.bonusReturnedQuantity,
              totalReturnedQuantity: line.totalReturnedQuantity,
              stockCondition: line.stockCondition,
              disposition: line.disposition,
              unitCost: new Prisma.Decimal(line.unitCost),
              unitPrice: new Prisma.Decimal(line.unitPrice),
              discountPercentage: new Prisma.Decimal(line.discountPercentage),
              discountAmount: new Prisma.Decimal(line.discountAmount),
              taxPercentage: new Prisma.Decimal(line.taxPercentage),
              taxAmount: new Prisma.Decimal(line.taxAmount),
              lineTotal: new Prisma.Decimal(line.lineTotal),
              lineCost: new Prisma.Decimal(line.lineCost),
              lineProfit: new Prisma.Decimal(line.lineProfit),
            },
          });

          // Inbound Stock Movement (restoration into exact destination warehouse)
          await tx.stockMovement.create({
            data: {
              organizationId,
              branchId,
              warehouseId: line.destinationWarehouseId,
              productId: line.productId,
              batchId: line.batchId,
              movementType: StockMovementType.SALES_RETURN,
              quantity: line.totalReturnedQuantity, // Positive (+) inbound
              unitCost: new Prisma.Decimal(line.unitCost),
              referenceType: 'SALES_RETURN',
              referenceId: salesReturn.id,
              notes: `Restocked (${line.stockCondition}) via return ${returnNumber} from invoice ${lockedInvoice.invoice_number}`,
              createdByUserId: userId || null,
            },
          });
        }

        // 9. Financial Settlement & Customer Sub-Ledger Updates
        // The portion of the return that acts as credit note against the invoice/receivable:
        const returnCreditPortion = Math.round((returnNetTotal - actualRefundAmount) * 100) / 100;

        // Invoice balance adjustment
        const currentInvoiceBal = Number(lockedInvoice.balance_amount);
        const newInvoiceBal = Math.max(
          0,
          Math.round((currentInvoiceBal - returnCreditPortion) * 100) / 100,
        );

        await tx.salesInvoice.update({
          where: { id: lockedInvoice.id },
          data: {
            balanceAmount: new Prisma.Decimal(newInvoiceBal),
          },
        });

        // Customer Sub-Ledger Entries
        let runningBalance = Number(lockedCustomer.current_balance);

        // A. Credit note reducing receivable (or creating customer credit if exceeds invoice balance)
        if (returnCreditPortion > 0) {
          runningBalance = Math.round((runningBalance - returnCreditPortion) * 100) / 100;

          await tx.customerLedgerEntry.create({
            data: {
              organizationId,
              branchId,
              customerId: lockedCustomer.id,
              salesInvoiceId: lockedInvoice.id,
              salesReturnId: salesReturn.id,
              entryType: CustomerLedgerEntryType.CREDIT_NOTE,
              referenceNumber: returnNumber,
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(returnCreditPortion),
              runningBalance: new Prisma.Decimal(runningBalance),
              notes: `Sales return credit note ${returnNumber} for invoice ${lockedInvoice.invoice_number}`,
              createdByUserId: userId || null,
            },
          });
        }

        // B. Immediate cash/bank payout: Paired CREDIT_NOTE + REFUND
        if (actualRefundAmount > 0) {
          // Paired entries for cash drawer / bank audit
          await tx.customerLedgerEntry.create({
            data: {
              organizationId,
              branchId,
              customerId: lockedCustomer.id,
              salesInvoiceId: lockedInvoice.id,
              salesReturnId: salesReturn.id,
              entryType: CustomerLedgerEntryType.CREDIT_NOTE,
              referenceNumber: returnNumber,
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(actualRefundAmount),
              runningBalance: new Prisma.Decimal(runningBalance - actualRefundAmount),
              notes: `Return credit before immediate refund for ${returnNumber}`,
              createdByUserId: userId || null,
            },
          });

          await tx.customerLedgerEntry.create({
            data: {
              organizationId,
              branchId,
              customerId: lockedCustomer.id,
              salesInvoiceId: lockedInvoice.id,
              salesReturnId: salesReturn.id,
              entryType: CustomerLedgerEntryType.REFUND,
              referenceNumber: returnNumber,
              debit: new Prisma.Decimal(actualRefundAmount),
              credit: new Prisma.Decimal(0),
              runningBalance: new Prisma.Decimal(runningBalance),
              notes: `Immediate ${dto.refundMode.replace('_', ' ')} payout for return ${returnNumber}`,
              createdByUserId: userId || null,
            },
          });
        }

        // Update Customer cached balance
        await tx.customer.update({
          where: { id: lockedCustomer.id },
          data: {
            currentBalance: new Prisma.Decimal(runningBalance),
          },
        });

        // 10. Audit Log
        await this.audit.log({
          userId,
          action: 'CREATE_SALES_RETURN',
          entity: 'SALES_RETURN',
          entityId: salesReturn.id,
          details: {
            returnNumber,
            invoiceNumber: lockedInvoice.invoice_number,
            netTotal: returnNetTotal,
            refundAmount: actualRefundAmount,
            reason: dto.reason,
            itemsCount: resolvedReturnLines.length,
          },
        });

        return salesReturn;
      },
      { timeout: 20000 },
    );
  }

  /**
   * Cancels/voids a posted Sales Return document with exact-warehouse stock availability validation,
   * compensating stock deduction, and ground-truth invoice settlement recalculation.
   */
  async cancelSalesReturn(id: string, dto: CancelSalesReturnDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Fetch return with items and destination warehouses
        const salesReturn = await tx.salesReturn.findFirst({
          where: { id, organizationId },
          include: {
            items: {
              include: {
                destinationWarehouse: true,
                batch: true,
                product: true,
              },
            },
            salesInvoice: true,
          },
        });

        if (!salesReturn) {
          throw new NotFoundException(`Sales return with ID "${id}" not found`);
        }

        if (salesReturn.status === SalesReturnStatus.CANCELLED) {
          throw new ConflictException(
            `Sales return "${salesReturn.returnNumber}" is already cancelled`,
          );
        }

        // 2. Exact-Warehouse Stock Availability Invariant
        for (const item of salesReturn.items) {
          const movements = await tx.stockMovement.findMany({
            where: {
              organizationId,
              warehouseId: item.destinationWarehouseId,
              batchId: item.batchId,
            },
            select: { quantity: true },
          });

          const currentWarehouseBalance = movements.reduce((sum, m) => sum + m.quantity, 0);

          if (currentWarehouseBalance < item.totalReturnedQuantity) {
            throw new BadRequestException(
              `Cannot cancel sales return "${salesReturn.returnNumber}": returned batch "${item.batchNumber}" has already been partially or fully consumed/transferred from warehouse "${item.destinationWarehouse.name}". Required for reversal: ${item.totalReturnedQuantity}, Currently available in warehouse: ${currentWarehouseBalance}.`,
            );
          }
        }

        // 3. Create compensating OUT stock movements
        for (const item of salesReturn.items) {
          await tx.stockMovement.create({
            data: {
              organizationId,
              branchId: salesReturn.branchId,
              warehouseId: item.destinationWarehouseId,
              productId: item.productId,
              batchId: item.batchId,
              movementType: StockMovementType.SALES_ISSUE,
              quantity: -item.totalReturnedQuantity, // Negative (-) deduction
              unitCost: item.unitCost,
              referenceType: 'SALES_RETURN_CANCEL',
              referenceId: salesReturn.id,
              notes: `Compensating stock deduction on cancellation of sales return ${salesReturn.returnNumber}`,
              createdByUserId: userId || null,
            },
          });
        }

        // 4. Lock customer row with FOR UPDATE
        const lockedCustomers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string }>
        >`
          SELECT id, current_balance, name
          FROM customers
          WHERE id = ${salesReturn.customerId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedCustomers.length) {
          throw new NotFoundException('Customer associated with return not found');
        }
        const lockedCustomer = lockedCustomers[0];

        // 5. Lock invoice and recalculate ground-truth settlement balances
        const lockedInvoices = await tx.$queryRaw<
          Array<{
            id: string;
            invoice_number: string;
            net_total: Prisma.Decimal;
            paid_amount: Prisma.Decimal;
            balance_amount: Prisma.Decimal;
          }>
        >`
          SELECT id, invoice_number, net_total, paid_amount, balance_amount
          FROM sales_invoices
          WHERE id = ${salesReturn.salesInvoiceId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (lockedInvoices.length > 0) {
          const lockedInvoice = lockedInvoices[0];

          // A. Checkout tenders
          const checkoutPayments = await tx.salesInvoicePayment.findMany({
            where: { salesInvoiceId: lockedInvoice.id },
          });
          const checkoutPaid = checkoutPayments.reduce(
            (sum, p) => sum + Number(p.amount),
            0,
          );

          // B. Active standalone payments
          const activeAllocations = await tx.customerPaymentAllocation.findMany({
            where: {
              salesInvoiceId: lockedInvoice.id,
              customerPayment: { status: 'POSTED' },
            },
          });
          const standalonePaid = activeAllocations.reduce(
            (sum, a) => sum + Number(a.amountAllocated),
            0,
          );

          // C. Other active sales returns (excluding the one being cancelled)
          const otherActiveReturns = await tx.salesReturn.findMany({
            where: {
              salesInvoiceId: lockedInvoice.id,
              status: SalesReturnStatus.POSTED,
              id: { not: salesReturn.id },
            },
          });
          const returnCredit = otherActiveReturns.reduce(
            (sum, r) => sum + (Number(r.netTotal) - Number(r.refundAmount)),
            0,
          );

          const netTotal = Number(lockedInvoice.net_total);
          const totalDirectPaid = Math.round((checkoutPaid + standalonePaid) * 100) / 100;
          const totalCredits = Math.round((totalDirectPaid + returnCredit) * 100) / 100;

          const recalculatedBalance = Math.max(
            0,
            Math.round((netTotal - totalCredits) * 100) / 100,
          );
          const recalculatedPaid = Math.max(
            0,
            Math.round((netTotal - recalculatedBalance) * 100) / 100,
          );

          await tx.salesInvoice.update({
            where: { id: lockedInvoice.id },
            data: {
              paidAmount: new Prisma.Decimal(recalculatedPaid),
              balanceAmount: new Prisma.Decimal(recalculatedBalance),
            },
          });
        }

        // 6. Customer Sub-Ledger Reversal
        const returnCreditPortion =
          Number(salesReturn.netTotal) - Number(salesReturn.refundAmount);
        const previousBalance = Number(lockedCustomer.current_balance);
        const newCustomerBalance = Math.round((previousBalance + returnCreditPortion) * 100) / 100;

        if (returnCreditPortion > 0) {
          await tx.customerLedgerEntry.create({
            data: {
              organizationId,
              branchId: salesReturn.branchId,
              customerId: lockedCustomer.id,
              salesInvoiceId: salesReturn.salesInvoiceId,
              salesReturnId: salesReturn.id,
              entryType: CustomerLedgerEntryType.ADJUSTMENT,
              referenceNumber: salesReturn.returnNumber,
              debit: new Prisma.Decimal(returnCreditPortion),
              credit: new Prisma.Decimal(0),
              runningBalance: new Prisma.Decimal(newCustomerBalance),
              notes: `Sales return ${salesReturn.returnNumber} cancelled/voided: ${dto.cancellationReason}`,
              createdByUserId: userId || null,
            },
          });

          await tx.customer.update({
            where: { id: lockedCustomer.id },
            data: {
              currentBalance: new Prisma.Decimal(newCustomerBalance),
            },
          });
        }

        // 7. Update SalesReturn Status
        const updatedReturn = await tx.salesReturn.update({
          where: { id: salesReturn.id },
          data: {
            status: SalesReturnStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledByUserId: userId || null,
            cancellationReason: dto.cancellationReason,
          },
        });

        // 8. Audit Log
        await this.audit.log({
          userId,
          action: 'CANCEL_SALES_RETURN',
          entity: 'SALES_RETURN',
          entityId: salesReturn.id,
          details: {
            returnNumber: salesReturn.returnNumber,
            cancellationReason: dto.cancellationReason,
          },
        });

        return updatedReturn;
      },
      { timeout: 20000 },
    );
  }

  /**
   * Retrieves paginated list of sales returns.
   */
  async findAll(query: QuerySalesReturnDto) {
    const organizationId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SalesReturnWhereInput = { organizationId };

    if (query.customerId) where.customerId = query.customerId;
    if (query.salesInvoiceId) where.salesInvoiceId = query.salesInvoiceId;
    if (query.status) where.status = query.status;
    if (query.reason) where.reason = query.reason;
    if (query.refundMode) where.refundMode = query.refundMode;

    if (query.startDate || query.endDate) {
      where.returnDate = {};
      if (query.startDate) where.returnDate.gte = new Date(query.startDate);
      if (query.endDate) where.returnDate.lte = new Date(query.endDate);
    }

    if (query.search) {
      where.OR = [
        { returnNumber: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { code: { contains: query.search, mode: 'insensitive' } } },
        { salesInvoice: { invoiceNumber: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total, aggregateSum] = await Promise.all([
      this.prisma.salesReturn.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ returnDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: {
            select: { id: true, name: true, code: true, phone: true },
          },
          salesInvoice: {
            select: { id: true, invoiceNumber: true, netTotal: true },
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
      this.prisma.salesReturn.count({ where }),
      this.prisma.salesReturn.aggregate({
        where,
        _sum: {
          netTotal: true,
          refundAmount: true,
          totalCostPrice: true,
          grossProfit: true,
        },
      }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      summary: {
        totalNetReturn: aggregateSum._sum.netTotal || 0,
        totalRefundAmount: aggregateSum._sum.refundAmount || 0,
        totalReversedCOGS: aggregateSum._sum.totalCostPrice || 0,
        totalReversedProfit: aggregateSum._sum.grossProfit || 0,
      },
    };
  }

  /**
   * Retrieves full details of a single sales return document.
   */
  async findOne(id: string) {
    const organizationId = await this.getOrganizationId();

    const salesReturn = await this.prisma.salesReturn.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        branch: {
          select: { id: true, name: true, code: true, city: true, address: true, phone: true },
        },
        salesInvoice: {
          select: {
            id: true,
            invoiceNumber: true,
            invoiceDate: true,
            netTotal: true,
            paidAmount: true,
            balanceAmount: true,
          },
        },
        postedByUser: {
          select: { id: true, displayName: true, username: true },
        },
        cancelledByUser: {
          select: { id: true, displayName: true, username: true },
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
                dosageForm: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                mfgDate: true,
              },
            },
            destinationWarehouse: {
              select: {
                id: true,
                name: true,
                code: true,
                warehouseType: true,
              },
            },
          },
        },
        ledgerEntries: true,
      },
    });

    if (!salesReturn) {
      throw new NotFoundException(`Sales return with ID "${id}" not found`);
    }

    return salesReturn;
  }
}
