import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { FefoService } from '../inventory/fefo.service';
import {
  CreateSalesInvoiceDto,
  CreateSalesInvoiceItemDto,
} from './dto/create-sales-invoice.dto';
import { FefoPreviewDto } from './dto/fefo-preview.dto';
import { QuerySalesInvoiceDto } from './dto/query-sales-invoice.dto';
import { CancelSalesInvoiceDto } from './dto/cancel-sales-invoice.dto';
import { Prisma, DocumentType, SalesInvoiceStatus } from '@prisma/client';

export interface ResolvedLineAllocation {
  productId: string;
  batchId: string;
  batchNumber: string;
  expiryDate: Date;
  billedQuantity: number;
  bonusQuantity: number;
  totalQuantity: number;
  unitCost: number;
  tradePrice: number;
  retailPrice: number;
  unitPrice: number;
  discountPercentage: number;
  discountAmount: number;
  taxPercentage: number;
  taxAmount: number;
  lineTotal: number;
  lineCost: number;
  lineProfit: number;
  remarks?: string;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly fefo: FefoService,
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
   * Advisory FEFO Preview endpoint for UI cart batch breakdown and stock checks.
   */
  async previewFefo(dto: FefoPreviewDto) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    const [warehouse, product] = await Promise.all([
      this.prisma.warehouse.findFirst({
        where: { id: dto.warehouseId, organizationId, branchId },
      }),
      this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId },
        include: {
          batches: {
            where: { status: 'ACTIVE', expiryDate: { gt: new Date() } },
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
    ]);

    if (!warehouse) {
      throw new NotFoundException(
        `Warehouse with ID "${dto.warehouseId}" not found in current branch`,
      );
    }
    if (!product) {
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    const fefoResult = await this.fefo.allocate({
      organizationId,
      branchId,
      warehouseId: dto.warehouseId,
      productId: dto.productId,
      requestedQuantity: dto.requestedQuantity,
    });

    // Check pricing rule if customerId is provided
    let customRule: any = null;
    let customer: any = null;
    if (dto.customerId) {
      [customRule, customer] = await Promise.all([
        this.prisma.customerPricingRule.findUnique({
          where: {
            customerId_productId: {
              customerId: dto.customerId,
              productId: dto.productId,
            },
          },
        }),
        this.prisma.customer.findFirst({
          where: { id: dto.customerId, organizationId },
        }),
      ]);
    }

    return {
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        genericName: product.genericName,
        taxPercentage: Number(product.taxPercentage),
      },
      customerPricing: {
        customPrice: customRule?.customPrice ? Number(customRule.customPrice) : null,
        discountPercentage: customRule?.discountPercentage
          ? Number(customRule.discountPercentage)
          : customer?.defaultDiscountPercentage
          ? Number(customer.defaultDiscountPercentage)
          : 0,
      },
      allocation: fefoResult,
    };
  }

  /**
   * Creates and optionally immediately posts a sales invoice.
   */
  async createSalesInvoice(dto: CreateSalesInvoiceDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Sales invoice must contain at least one item');
    }

    // If marked as DRAFT, save parked bill without locking or stock deduction
    if (dto.isDraft) {
      return this.createDraftInvoice(organizationId, branchId, userId, dto);
    }

    // Execute atomic POSTED sale inside transaction
    return this.postInvoiceTransaction(organizationId, branchId, userId, dto);
  }

  /**
   * Promotes an existing DRAFT invoice to POSTED.
   */
  async postDraftInvoice(invoiceId: string, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    const draft = await this.prisma.salesInvoice.findFirst({
      where: { id: invoiceId, organizationId, branchId },
      include: {
        items: true,
        payments: true,
      },
    });

    if (!draft) {
      throw new NotFoundException(`Invoice with ID "${invoiceId}" not found`);
    }
    if (draft.status !== 'DRAFT') {
      throw new BadRequestException(
        `Only DRAFT invoices can be posted. Current status is ${draft.status}`,
      );
    }

    const dto: CreateSalesInvoiceDto = {
      customerId: draft.customerId,
      warehouseId: draft.warehouseId,
      paymentMethod: draft.paymentMethod,
      invoiceDate: draft.invoiceDate.toISOString(),
      items: draft.items.map((it) => ({
        productId: it.productId,
        batchId: it.batchId,
        billedQuantity: it.billedQuantity,
        bonusQuantity: it.bonusQuantity,
        unitPrice: Number(it.unitPrice),
        discountPercentage: Number(it.discountPercentage),
        taxPercentage: Number(it.taxPercentage),
      })),
      payments: draft.payments.map((p) => ({
        paymentMethod: p.paymentMethod,
        amount: Number(p.amount),
        referenceNumber: p.referenceNumber || undefined,
        notes: p.notes || undefined,
      })),
      notes: draft.notes || undefined,
      isDraft: false,
    };

    // Delete draft and post cleanly within transaction
    await this.prisma.salesInvoice.delete({ where: { id: invoiceId } });
    return this.postInvoiceTransaction(organizationId, branchId, userId, dto);
  }

  /**
   * Cancels a POSTED sales invoice with compensating stock movements and ledger reversal.
   */
  async cancelSalesInvoice(
    invoiceId: string,
    userId: string | undefined,
    dto: CancelSalesInvoiceDto,
  ) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock invoice row FOR UPDATE
      const [lockedInvoice] = await tx.$queryRaw<any[]>(
        Prisma.sql`SELECT id, status, customer_id, branch_id, warehouse_id, invoice_number, net_total, paid_amount, balance_amount
                   FROM sales_invoices
                   WHERE id = ${invoiceId} AND organization_id = ${organizationId}
                   FOR UPDATE`,
      );

      if (!lockedInvoice) {
        throw new NotFoundException(`Sales invoice with ID "${invoiceId}" not found`);
      }
      if (lockedInvoice.status === 'CANCELLED') {
        throw new BadRequestException('Sales invoice is already cancelled');
      }
      if (lockedInvoice.status !== 'POSTED') {
        throw new BadRequestException(
          `Only POSTED sales invoices can be cancelled. Current status is ${lockedInvoice.status}`,
        );
      }

      // 2. Lock customer row FOR UPDATE
      const [lockedCustomer] = await tx.$queryRaw<any[]>(
        Prisma.sql`SELECT id, code, name, current_balance
                   FROM customers
                   WHERE id = ${lockedInvoice.customer_id} AND organization_id = ${organizationId}
                   FOR UPDATE`,
      );

      if (!lockedCustomer) {
        throw new NotFoundException(`Associated customer not found`);
      }

      // Fetch invoice items for stock reversal
      const items = await tx.salesInvoiceItem.findMany({
        where: { salesInvoiceId: invoiceId },
      });

      // 3. Create compensating positive StockMovement records
      for (const item of items) {
        await tx.stockMovement.create({
          data: {
            organizationId,
            branchId: lockedInvoice.branch_id,
            warehouseId: lockedInvoice.warehouse_id,
            productId: item.productId,
            batchId: item.batchId,
            movementType: 'SALES_RETURN',
            quantity: item.totalQuantity, // Positive signed: restores physical stock
            unitCost: item.unitCost,
            referenceType: 'SALES_INVOICE_CANCEL',
            referenceId: invoiceId,
            notes: `Stock restoration on cancellation of invoice ${lockedInvoice.invoice_number}: ${dto.cancellationReason}`,
            createdByUserId: userId || null,
          },
        });
      }

      const netTotal = Number(lockedInvoice.net_total);
      const paidAmount = Number(lockedInvoice.paid_amount);
      const balanceAmount = Number(lockedInvoice.balance_amount);
      let customerBalance = Number(lockedCustomer.current_balance);

      // 4. Financial Ledger Reversals
      if (balanceAmount > 0) {
        // Unpaid credit portion reversed
        customerBalance -= balanceAmount;
        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId: lockedInvoice.branch_id,
            customerId: lockedCustomer.id,
            salesInvoiceId: invoiceId,
            entryType: 'CREDIT_NOTE',
            referenceNumber: lockedInvoice.invoice_number || 'CANCEL',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(balanceAmount),
            runningBalance: new Prisma.Decimal(customerBalance),
            notes: `Receivable credit reversal for cancelled invoice ${lockedInvoice.invoice_number}: ${dto.cancellationReason}`,
            createdByUserId: userId || null,
          },
        });
      }

      if (paidAmount > 0) {
        // Paid portion: record paired REFUND debit + CREDIT_NOTE credit for cash drawer audit
        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId: lockedInvoice.branch_id,
            customerId: lockedCustomer.id,
            salesInvoiceId: invoiceId,
            entryType: 'REFUND',
            referenceNumber: lockedInvoice.invoice_number || 'REFUND',
            debit: new Prisma.Decimal(paidAmount),
            credit: new Prisma.Decimal(0),
            runningBalance: new Prisma.Decimal(customerBalance),
            notes: `Cash/Tender refund disbursement for cancelled invoice ${lockedInvoice.invoice_number}`,
            createdByUserId: userId || null,
          },
        });

        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId: lockedInvoice.branch_id,
            customerId: lockedCustomer.id,
            salesInvoiceId: invoiceId,
            entryType: 'CREDIT_NOTE',
            referenceNumber: lockedInvoice.invoice_number || 'CANCEL',
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(paidAmount),
            runningBalance: new Prisma.Decimal(customerBalance),
            notes: `Invoice payment cancellation credit for ${lockedInvoice.invoice_number}`,
            createdByUserId: userId || null,
          },
        });
      }

      // Update cached customer balance
      await tx.customer.update({
        where: { id: lockedCustomer.id },
        data: { currentBalance: new Prisma.Decimal(customerBalance) },
      });

      // Update SalesInvoice status to CANCELLED
      const cancelledInvoice = await tx.salesInvoice.update({
        where: { id: invoiceId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByUserId: userId || null,
          cancellationReason: dto.cancellationReason,
        },
        include: {
          customer: true,
          items: true,
          payments: true,
        },
      });

      await this.audit.log({
        userId,
        action: 'CANCEL_SALES_INVOICE',
        entity: 'SALES_INVOICE',
        entityId: invoiceId,
        details: {
          invoiceNumber: lockedInvoice.invoice_number,
          reason: dto.cancellationReason,
          restoredItemsCount: items.length,
          netTotal,
          paidAmount,
        },
      });

      return cancelledInvoice;
    });
  }

  /**
   * Internal helper to create a unposted DRAFT invoice without locks or stock movements.
   */
  private async createDraftInvoice(
    organizationId: string,
    branchId: string,
    userId: string | undefined,
    dto: CreateSalesInvoiceDto,
  ) {
    const draftNumber = `DFT-${Date.now().toString().slice(-6)}`;

    // Quick resolve prices for draft display
    let subtotal = 0;
    let totalTax = 0;
    let totalDiscount = 0;

    const draftItemsData = [];

    for (const item of dto.items) {
      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, organizationId },
      });
      if (!product) {
        throw new NotFoundException(`Product with ID "${item.productId}" not found`);
      }

      let batch: any = null;
      if (item.batchId) {
        batch = await this.prisma.batch.findUnique({
          where: { id: item.batchId },
        });
      } else {
        batch = await this.prisma.batch.findFirst({
          where: {
            productId: item.productId,
            status: 'ACTIVE',
            expiryDate: { gt: new Date() },
          },
          orderBy: [{ expiryDate: 'asc' }],
        });
      }

      const unitPrice = item.unitPrice ?? (batch ? Number(batch.tradePrice) : 0);
      const discountPct = item.discountPercentage ?? 0;
      const taxPct = item.taxPercentage ?? Number(product.taxPercentage);
      const billedQty = item.billedQuantity;
      const bonusQty = item.bonusQuantity ?? 0;
      const totalQty = billedQty + bonusQty;

      const gross = billedQty * unitPrice;
      const discAmt = gross * (discountPct / 100);
      const taxable = gross - discAmt;
      const taxAmt = taxable * (taxPct / 100);
      const lineTotal = taxable + taxAmt;
      const unitCost = batch ? Number(batch.purchaseCost) : 0;
      const lineCost = totalQty * unitCost;

      subtotal += gross;
      totalDiscount += discAmt;
      totalTax += taxAmt;

      draftItemsData.push({
        productId: item.productId,
        batchId: batch ? batch.id : '',
        batchNumber: batch ? batch.batchNumber : 'AUTO',
        expiryDate: batch ? batch.expiryDate : new Date(),
        billedQuantity: billedQty,
        bonusQuantity: bonusQty,
        totalQuantity: totalQty,
        unitCost: new Prisma.Decimal(unitCost),
        tradePrice: new Prisma.Decimal(batch ? Number(batch.tradePrice) : 0),
        retailPrice: new Prisma.Decimal(batch ? Number(batch.retailPrice) : 0),
        unitPrice: new Prisma.Decimal(unitPrice),
        discountPercentage: new Prisma.Decimal(discountPct),
        discountAmount: new Prisma.Decimal(discAmt),
        taxPercentage: new Prisma.Decimal(taxPct),
        taxAmount: new Prisma.Decimal(taxAmt),
        lineTotal: new Prisma.Decimal(lineTotal),
        lineCost: new Prisma.Decimal(lineCost),
        lineProfit: new Prisma.Decimal(taxable - lineCost),
      });
    }

    const netTotal = subtotal - totalDiscount + totalTax;

    const draft = await this.prisma.salesInvoice.create({
      data: {
        organizationId,
        branchId,
        warehouseId: dto.warehouseId,
        customerId: dto.customerId,
        draftNumber,
        status: 'DRAFT',
        paymentMethod: dto.paymentMethod || 'CASH',
        invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : new Date(),
        subtotal: new Prisma.Decimal(subtotal),
        discountAmount: new Prisma.Decimal(totalDiscount),
        taxAmount: new Prisma.Decimal(totalTax),
        netTotal: new Prisma.Decimal(netTotal),
        paidAmount: new Prisma.Decimal(0),
        balanceAmount: new Prisma.Decimal(netTotal),
        notes: dto.notes?.trim() || null,
        items: {
          create: draftItemsData,
        },
      },
      include: {
        customer: true,
        items: true,
      },
    });

    return draft;
  }

  /**
   * Core atomic posting transaction.
   */
  private async postInvoiceTransaction(
    organizationId: string,
    branchId: string,
    userId: string | undefined,
    dto: CreateSalesInvoiceDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Lock Customer row FOR UPDATE
      const [lockedCustomer] = await tx.$queryRaw<any[]>(
        Prisma.sql`SELECT id, code, name, customer_type, credit_limit, credit_days, current_balance, default_discount_percentage, is_tax_exempt, is_active
                   FROM customers
                   WHERE id = ${dto.customerId} AND organization_id = ${organizationId}
                   FOR UPDATE`,
      );

      if (!lockedCustomer) {
        throw new NotFoundException(`Customer with ID "${dto.customerId}" not found`);
      }
      if (!lockedCustomer.is_active) {
        throw new BadRequestException(
          `Customer "${lockedCustomer.name}" is currently deactivated`,
        );
      }

      // Check warehouse exists in branch
      const warehouse = await tx.warehouse.findFirst({
        where: { id: dto.warehouseId, organizationId, branchId, isActive: true },
      });
      if (!warehouse) {
        throw new NotFoundException(
          `Active warehouse with ID "${dto.warehouseId}" not found in branch`,
        );
      }

      // 2. Fetch pricing setting default
      const pricingSetting = await tx.systemSetting.findUnique({
        where: {
          organizationId_key: {
            organizationId,
            key: 'DEFAULT_SALES_PRICING_BASE',
          },
        },
      });
      const defaultPricingBase = pricingSetting?.value === 'MRP' ? 'MRP' : 'TP';

      const now = new Date();
      const resolvedLines: ResolvedLineAllocation[] = [];
      const batchIdsToLock = new Set<string>();

      // Step 2a: Identify candidate batches for each item
      for (const itemDto of dto.items) {
        const product = await tx.product.findFirst({
          where: { id: itemDto.productId, organizationId, isActive: true },
        });
        if (!product) {
          throw new NotFoundException(
            `Active Product with ID "${itemDto.productId}" not found`,
          );
        }

        const totalNeeded = itemDto.billedQuantity + (itemDto.bonusQuantity || 0);
        if (totalNeeded <= 0) {
          throw new BadRequestException(
            `Total quantity for product "${product.name}" must be greater than zero`,
          );
        }

        if (itemDto.batchId) {
          // Manual batch specified
          const b = await tx.batch.findFirst({
            where: {
              id: itemDto.batchId,
              productId: product.id,
              status: 'ACTIVE',
              expiryDate: { gt: now },
            },
          });
          if (!b) {
            throw new BadRequestException(
              `Specified batch for product "${product.name}" is invalid, inactive, or expired`,
            );
          }
          batchIdsToLock.add(b.id);
        } else {
          // Auto FEFO candidates
          const candidates = await tx.batch.findMany({
            where: {
              productId: product.id,
              status: 'ACTIVE',
              expiryDate: { gt: now },
            },
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
          });
          if (candidates.length === 0) {
            throw new BadRequestException(
              `No active non-expired batches found for product "${product.name}"`,
            );
          }
          candidates.forEach((c) => batchIdsToLock.add(c.id));
        }
      }

      // Step 2b: Lock all candidate batches in deterministic order (ORDER BY id ASC FOR UPDATE)
      const sortedBatchIds = Array.from(batchIdsToLock).sort();
      const lockedBatches: any[] = await tx.$queryRaw(
        Prisma.sql`SELECT id, product_id, batch_number, expiry_date, purchase_cost, trade_price, retail_price
                   FROM batches
                   WHERE id IN (${Prisma.join(sortedBatchIds)})
                   ORDER BY id ASC
                   FOR UPDATE`,
      );

      const batchMap = new Map<string, any>();
      lockedBatches.forEach((b) => batchMap.set(b.id, b));

      // Step 2c: Calculate live exact-scope available stock for each locked batch
      const batchStockMap = new Map<string, number>();
      for (const b of lockedBatches) {
        const [sumRes] = await tx.$queryRaw<any[]>(
          Prisma.sql`SELECT COALESCE(SUM(quantity), 0) as balance
                     FROM stock_movements
                     WHERE organization_id = ${organizationId}
                       AND branch_id = ${branchId}
                       AND warehouse_id = ${dto.warehouseId}
                       AND batch_id = ${b.id}`,
        );
        batchStockMap.set(b.id, Number(sumRes.balance));
      }

      // Step 2d: Allocate stock and build discrete lines
      for (const itemDto of dto.items) {
        const product = await tx.product.findFirst({
          where: { id: itemDto.productId },
        });

        // Pricing rule lookup
        const customRule = await tx.customerPricingRule.findUnique({
          where: {
            customerId_productId: {
              customerId: lockedCustomer.id,
              productId: itemDto.productId,
            },
          },
        });

        const totalNeeded = itemDto.billedQuantity + (itemDto.bonusQuantity || 0);
        let remainingBilled = itemDto.billedQuantity;
        let remainingBonus = itemDto.bonusQuantity || 0;
        let remainingTotal = totalNeeded;

        if (itemDto.batchId) {
          const b = batchMap.get(itemDto.batchId);
          const currentAvailable = batchStockMap.get(b.id) || 0;

          if (currentAvailable < totalNeeded) {
            throw new BadRequestException(
              `Insufficient stock for batch "${b.batch_number}" of "${product?.name}". Available: ${currentAvailable}, Requested: ${totalNeeded}`,
            );
          }

          // Deduct from local pool
          batchStockMap.set(b.id, currentAvailable - totalNeeded);

          const resolved = this.computeLineCommercials({
            product: product!,
            batch: b,
            customer: lockedCustomer,
            customRule,
            defaultPricingBase,
            billedQuantity: remainingBilled,
            bonusQuantity: remainingBonus,
            manualUnitPrice: itemDto.unitPrice,
            manualDiscountPct: itemDto.discountPercentage,
            manualTaxPct: itemDto.taxPercentage,
            remarks: itemDto.remarks,
          });
          resolvedLines.push(resolved);
        } else {
          // Auto FEFO Allocation across candidate batches
          const productBatches = lockedBatches
            .filter((b) => b.product_id === itemDto.productId)
            .sort(
              (a, b) =>
                new Date(a.expiry_date).getTime() -
                new Date(b.expiry_date).getTime(),
            );

          for (const b of productBatches) {
            if (remainingTotal <= 0) break;
            const currentAvailable = batchStockMap.get(b.id) || 0;
            if (currentAvailable <= 0) continue;

            const sliceTotal = Math.min(remainingTotal, currentAvailable);

            // Pro-rate billed vs bonus into this batch slice
            let sliceBilled = 0;
            let sliceBonus = 0;

            if (remainingBilled > 0) {
              sliceBilled = Math.min(remainingBilled, sliceTotal);
              remainingBilled -= sliceBilled;
            }
            const remainingSliceCapacity = sliceTotal - sliceBilled;
            if (remainingSliceCapacity > 0 && remainingBonus > 0) {
              sliceBonus = Math.min(remainingBonus, remainingSliceCapacity);
              remainingBonus -= sliceBonus;
            }

            batchStockMap.set(b.id, currentAvailable - sliceTotal);
            remainingTotal -= sliceTotal;

            const resolved = this.computeLineCommercials({
              product: product!,
              batch: b,
              customer: lockedCustomer,
              customRule,
              defaultPricingBase,
              billedQuantity: sliceBilled,
              bonusQuantity: sliceBonus,
              manualUnitPrice: itemDto.unitPrice,
              manualDiscountPct: itemDto.discountPercentage,
              manualTaxPct: itemDto.taxPercentage,
              remarks: itemDto.remarks,
            });
            resolvedLines.push(resolved);
          }

          if (remainingTotal > 0) {
            throw new BadRequestException(
              `Insufficient overall stock for product "${product?.name}". Shortfall: ${remainingTotal} units`,
            );
          }
        }
      }

      // 3. Financial Totals Aggregation
      let subtotal = 0;
      let lineDiscounts = 0;
      let totalTax = 0;
      let totalCostPrice = 0;

      for (const line of resolvedLines) {
        subtotal += line.billedQuantity * line.unitPrice;
        lineDiscounts += line.discountAmount;
        totalTax += line.taxAmount;
        totalCostPrice += line.lineCost;
      }

      const overallDiscount = dto.overallDiscountAmount
        ? Number(dto.overallDiscountAmount)
        : 0;
      const totalDiscountAmount = lineDiscounts + overallDiscount;
      const netTotal = Math.max(0, subtotal - totalDiscountAmount + totalTax);

      // 4. Payment Tenders & Balance Settlement
      let paidAmount = 0;
      const paymentsToCreate: any[] = [];

      if (dto.payments && dto.payments.length > 0) {
        for (const p of dto.payments) {
          const amt = Number(p.amount);
          if (amt > 0) {
            paidAmount += amt;
            paymentsToCreate.push({
              paymentMethod: p.paymentMethod,
              amount: new Prisma.Decimal(amt),
              referenceNumber: p.referenceNumber?.trim() || null,
              notes: p.notes?.trim() || null,
            });
          }
        }
      } else if (dto.paymentMethod === 'CASH') {
        // Default cash sale full tender
        paidAmount = netTotal;
        paymentsToCreate.push({
          paymentMethod: 'CASH',
          amount: new Prisma.Decimal(netTotal),
          notes: 'Full cash payment at counter checkout',
        });
      }

      const balanceAmount = Math.max(0, netTotal - paidAmount);
      const grossProfit = netTotal - totalTax - totalCostPrice;

      // 5. Credit Limit Validation (if balance amount left to bill on credit account)
      if (balanceAmount > 0) {
        const creditDays = Number(lockedCustomer.credit_days);
        const creditLimit = Number(lockedCustomer.credit_limit);
        const currentBalance = Number(lockedCustomer.current_balance);

        if (creditDays <= 0 && lockedCustomer.customer_type === 'WALK_IN') {
          throw new BadRequestException(
            'Walk-in cash customers cannot purchase on credit. Full payment required at checkout.',
          );
        }

        if (currentBalance + balanceAmount > creditLimit) {
          throw new BadRequestException(
            `Sale exceeds customer credit limit! Current balance: Rs.${currentBalance.toFixed(
              2,
            )}, New unpaid balance: Rs.${balanceAmount.toFixed(
              2,
            )}, Credit Limit: Rs.${creditLimit.toFixed(2)}`,
          );
        }
      }

      // 6. Generate sequential DocumentType.SALES_INVOICE Number
      const numResult = await this.numbering.generateNextNumber(
        DocumentType.SALES_INVOICE,
        branchId,
      );
      const invoiceNumber = numResult.documentNumber;

      // 7. Insert SalesInvoice Header (POSTED)
      const invoice = await tx.salesInvoice.create({
        data: {
          organizationId,
          branchId,
          warehouseId: dto.warehouseId,
          customerId: lockedCustomer.id,
          invoiceNumber,
          invoiceDate: dto.invoiceDate ? new Date(dto.invoiceDate) : new Date(),
          status: 'POSTED',
          paymentMethod: dto.paymentMethod || 'CASH',
          subtotal: new Prisma.Decimal(subtotal),
          discountAmount: new Prisma.Decimal(totalDiscountAmount),
          taxAmount: new Prisma.Decimal(totalTax),
          netTotal: new Prisma.Decimal(netTotal),
          paidAmount: new Prisma.Decimal(paidAmount),
          balanceAmount: new Prisma.Decimal(balanceAmount),
          totalCostPrice: new Prisma.Decimal(totalCostPrice),
          grossProfit: new Prisma.Decimal(grossProfit),
          notes: dto.notes?.trim() || null,
          postedAt: new Date(),
          postedByUserId: userId || null,
        },
      });

      // 8. Insert SalesInvoiceItem rows (Discrete per batch)
      for (const line of resolvedLines) {
        await tx.salesInvoiceItem.create({
          data: {
            salesInvoiceId: invoice.id,
            productId: line.productId,
            batchId: line.batchId,
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate,
            billedQuantity: line.billedQuantity,
            bonusQuantity: line.bonusQuantity,
            totalQuantity: line.totalQuantity,
            unitCost: new Prisma.Decimal(line.unitCost),
            tradePrice: new Prisma.Decimal(line.tradePrice),
            retailPrice: new Prisma.Decimal(line.retailPrice),
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

        // 9. Insert StockMovement (Negative signed physical issue)
        await tx.stockMovement.create({
          data: {
            organizationId,
            branchId,
            warehouseId: dto.warehouseId,
            productId: line.productId,
            batchId: line.batchId,
            movementType: 'SALES_ISSUE',
            quantity: -line.totalQuantity, // Negative signed
            unitCost: new Prisma.Decimal(line.unitCost),
            referenceType: 'SALES_INVOICE',
            referenceId: invoice.id,
            notes: `Sales issue for invoice ${invoiceNumber} (Billed: ${line.billedQuantity}, Bonus: ${line.bonusQuantity})`,
            createdByUserId: userId || null,
          },
        });
      }

      // 10. Insert SalesInvoicePayment Tender rows
      for (const p of paymentsToCreate) {
        await tx.salesInvoicePayment.create({
          data: {
            salesInvoiceId: invoice.id,
            paymentMethod: p.paymentMethod,
            amount: p.amount,
            referenceNumber: p.referenceNumber,
            notes: p.notes,
          },
        });
      }

      // 11. Customer Financial Sub-Ledger Entries
      let runningBalance = Number(lockedCustomer.current_balance);

      // Debit: Full invoice receivable addition
      runningBalance += netTotal;
      await tx.customerLedgerEntry.create({
        data: {
          organizationId,
          branchId,
          customerId: lockedCustomer.id,
          salesInvoiceId: invoice.id,
          entryType: 'SALES_INVOICE',
          referenceNumber: invoiceNumber,
          debit: new Prisma.Decimal(netTotal),
          credit: new Prisma.Decimal(0),
          runningBalance: new Prisma.Decimal(runningBalance),
          notes: `Sales invoice ${invoiceNumber}`,
          createdByUserId: userId || null,
        },
      });

      // Credit: Immediate payments tendered at checkout
      if (paidAmount > 0) {
        runningBalance -= paidAmount;
        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId,
            customerId: lockedCustomer.id,
            salesInvoiceId: invoice.id,
            entryType: 'PAYMENT',
            referenceNumber: invoiceNumber,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(paidAmount),
            runningBalance: new Prisma.Decimal(runningBalance),
            notes: `Checkout payment collection for ${invoiceNumber}`,
            createdByUserId: userId || null,
          },
        });
      }

      // 12. Update Customer Cached Balance
      await tx.customer.update({
        where: { id: lockedCustomer.id },
        data: { currentBalance: new Prisma.Decimal(runningBalance) },
      });

      // 13. Audit Log
      await this.audit.log({
        userId,
        action: 'POST_SALES_INVOICE',
        entity: 'SALES_INVOICE',
        entityId: invoice.id,
        details: {
          invoiceNumber,
          customerId: lockedCustomer.id,
          customerCode: lockedCustomer.code,
          itemCount: resolvedLines.length,
          netTotal,
          paidAmount,
          balanceAmount,
          grossProfit,
        },
      });

      return invoice;
    });
  }

  /**
   * Helper: Resolves price precedence and computes commercial values for a batch slice.
   */
  private computeLineCommercials(params: {
    product: any;
    batch: any;
    customer: any;
    customRule: any;
    defaultPricingBase: 'TP' | 'MRP';
    billedQuantity: number;
    bonusQuantity: number;
    manualUnitPrice?: number;
    manualDiscountPct?: number;
    manualTaxPct?: number;
    remarks?: string;
  }): ResolvedLineAllocation {
    const {
      product,
      batch,
      customer,
      customRule,
      defaultPricingBase,
      billedQuantity,
      bonusQuantity,
      manualUnitPrice,
      manualDiscountPct,
      manualTaxPct,
      remarks,
    } = params;

    const retailPrice = Number(batch.retail_price ?? batch.retailPrice);
    const tradePrice = Number(batch.trade_price ?? batch.tradePrice);
    const unitCost = Number(batch.purchase_cost ?? batch.purchaseCost);

    // 1. Resolve Base Unit Price
    let unitPrice = 0;
    if (manualUnitPrice !== undefined && manualUnitPrice !== null) {
      unitPrice = Number(manualUnitPrice);
    } else if (customRule?.customPrice) {
      unitPrice = Number(customRule.customPrice);
    } else if (defaultPricingBase === 'MRP') {
      unitPrice = retailPrice;
    } else {
      unitPrice = tradePrice;
    }

    // 2. Resolve Discount (Precedence: Manual > CustomRule > Customer Default. Discounts do NOT stack)
    let discountPercentage = 0;
    if (manualDiscountPct !== undefined && manualDiscountPct !== null) {
      discountPercentage = Number(manualDiscountPct);
    } else if (customRule?.discountPercentage) {
      discountPercentage = Number(customRule.discountPercentage);
    } else if (customer.default_discount_percentage || customer.defaultDiscountPercentage) {
      discountPercentage = Number(
        customer.default_discount_percentage || customer.defaultDiscountPercentage,
      );
    }

    // 3. MRP Ceiling Validation Invariant
    const effectiveUnitPrice = unitPrice * (1 - discountPercentage / 100);
    if (unitPrice > retailPrice || effectiveUnitPrice > retailPrice) {
      throw new BadRequestException(
        `Unit price Rs.${unitPrice.toFixed(
          2,
        )} for product "${product.name}" exceeds Maximum Retail Price (MRP) Rs.${retailPrice.toFixed(
          2,
        )}`,
      );
    }

    // 4. Tax percentage
    const isTaxExempt = customer.is_tax_exempt ?? customer.isTaxExempt;
    let taxPercentage = 0;
    if (!isTaxExempt) {
      taxPercentage =
        manualTaxPct !== undefined && manualTaxPct !== null
          ? Number(manualTaxPct)
          : Number(product.taxPercentage);
    }

    // 5. Line Totals
    const gross = billedQuantity * unitPrice;
    const discountAmount = gross * (discountPercentage / 100);
    const taxableAmount = gross - discountAmount;
    const taxAmount = taxableAmount * (taxPercentage / 100);
    const lineTotal = taxableAmount + taxAmount;

    const totalQuantity = billedQuantity + bonusQuantity;
    const lineCost = totalQuantity * unitCost;
    const lineProfit = taxableAmount - lineCost;

    return {
      productId: product.id,
      batchId: batch.id,
      batchNumber: batch.batch_number ?? batch.batchNumber,
      expiryDate: new Date(batch.expiry_date ?? batch.expiryDate),
      billedQuantity,
      bonusQuantity,
      totalQuantity,
      unitCost,
      tradePrice,
      retailPrice,
      unitPrice,
      discountPercentage,
      discountAmount,
      taxPercentage,
      taxAmount,
      lineTotal,
      lineCost,
      lineProfit,
      remarks,
    };
  }

  /**
   * Retrieves paginated list of sales invoices.
   */
  async getInvoices(query: QuerySalesInvoiceDto) {
    const organizationId = await this.getOrganizationId();
    const {
      search,
      customerId,
      branchId,
      warehouseId,
      status,
      paymentMethod,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.SalesInvoiceWhereInput = {
      organizationId,
      ...(customerId && { customerId }),
      ...(branchId && { branchId }),
      ...(warehouseId && { warehouseId }),
      ...(status && { status }),
      ...(paymentMethod && { paymentMethod }),
      ...(startDate || endDate
        ? {
            invoiceDate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          }
        : {}),
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { draftNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { code: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.salesInvoice.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              customerType: true,
              phone: true,
            },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
          warehouse: {
            select: { id: true, name: true, code: true },
          },
          _count: {
            select: { items: true, payments: true },
          },
        },
      }),
      this.prisma.salesInvoice.count({ where }),
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
   * Retrieves full details for a sales invoice.
   */
  async getInvoiceById(id: string) {
    const organizationId = await this.getOrganizationId();
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        branch: true,
        warehouse: true,
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
              },
            },
          },
        },
        payments: true,
        ledgerEntries: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(`Sales invoice with ID "${id}" not found`);
    }

    return invoice;
  }

  /**
   * Computes station sales metrics.
   */
  async getSalesMetrics(branchId?: string) {
    const organizationId = await this.getOrganizationId();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const whereBase: Prisma.SalesInvoiceWhereInput = {
      organizationId,
      ...(branchId && { branchId }),
      status: 'POSTED',
    };

    const [todayStats, allTimeStats, draftCount] = await Promise.all([
      this.prisma.salesInvoice.aggregate({
        where: {
          ...whereBase,
          invoiceDate: { gte: today },
        },
        _sum: {
          netTotal: true,
          paidAmount: true,
          balanceAmount: true,
          grossProfit: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.salesInvoice.aggregate({
        where: whereBase,
        _sum: {
          netTotal: true,
          paidAmount: true,
          balanceAmount: true,
          grossProfit: true,
        },
        _count: {
          id: true,
        },
      }),
      this.prisma.salesInvoice.count({
        where: {
          organizationId,
          ...(branchId && { branchId }),
          status: 'DRAFT',
        },
      }),
    ]);

    return {
      today: {
        invoiceCount: todayStats._count.id || 0,
        grossSales: Number(todayStats._sum.netTotal || 0),
        cashCollected: Number(todayStats._sum.paidAmount || 0),
        creditReceivablesAdded: Number(todayStats._sum.balanceAmount || 0),
        grossProfit: Number(todayStats._sum.grossProfit || 0),
      },
      allTime: {
        invoiceCount: allTimeStats._count.id || 0,
        grossSales: Number(allTimeStats._sum.netTotal || 0),
        cashCollected: Number(allTimeStats._sum.paidAmount || 0),
        outstandingReceivables: Number(allTimeStats._sum.balanceAmount || 0),
        grossProfit: Number(allTimeStats._sum.grossProfit || 0),
      },
      draftInvoicesCount: draftCount,
    };
  }
}
