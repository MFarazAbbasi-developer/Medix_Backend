import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { QueryCustomerPaymentDto } from './dto/query-customer-payment.dto';
import { CancelCustomerPaymentDto } from './dto/cancel-customer-payment.dto';
import {
  Prisma,
  DocumentType,
  CustomerPaymentStatus,
  SalesInvoiceStatus,
  CustomerLedgerEntryType,
} from '@prisma/client';

@Injectable()
export class CustomerPaymentService {
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
   * Retrieves all unpaid / partially-paid posted invoices for a customer (FIFO ordering).
   */
  async getUnpaidInvoices(customerId: string) {
    const organizationId = await this.getOrganizationId();

    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }

    return this.prisma.salesInvoice.findMany({
      where: {
        organizationId,
        customerId,
        status: SalesInvoiceStatus.POSTED,
        balanceAmount: { gt: 0 },
      },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        subtotal: true,
        discountAmount: true,
        taxAmount: true,
        netTotal: true,
        paidAmount: true,
        balanceAmount: true,
        status: true,
        _count: {
          select: { items: true },
        },
      },
    });
  }

  /**
   * Creates and posts a customer payment receipt with multi-invoice allocation and advance support.
   */
  async createPayment(dto: CreateCustomerPaymentDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    if (dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    // Validate allocations if provided
    let totalAllocated = 0;
    if (dto.allocations && dto.allocations.length > 0) {
      const invoiceIds = dto.allocations.map((a) => a.salesInvoiceId);
      const uniqueIds = new Set(invoiceIds);
      if (uniqueIds.size !== invoiceIds.length) {
        throw new BadRequestException('Duplicate invoice IDs detected in allocation list');
      }

      for (const a of dto.allocations) {
        if (a.amountAllocated <= 0) {
          throw new BadRequestException('Allocated amount for each invoice must be greater than 0');
        }
        totalAllocated += a.amountAllocated;
      }

      // Round to 2 decimal places to avoid floating point precision issues
      totalAllocated = Math.round(totalAllocated * 100) / 100;
      const paymentAmount = Math.round(dto.amount * 100) / 100;

      if (totalAllocated > paymentAmount) {
        throw new BadRequestException(
          `Total allocated amount (Rs. ${totalAllocated.toFixed(2)}) cannot exceed total payment amount (Rs. ${paymentAmount.toFixed(2)})`,
        );
      }
    }

    const unallocatedAmount = Math.round((dto.amount - totalAllocated) * 100) / 100;

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Lock customer row with FOR UPDATE
        const lockedCustomers = await tx.$queryRaw<Array<{ id: string; current_balance: Prisma.Decimal; name: string; is_active: boolean }>>`
          SELECT id, current_balance, name, is_active FROM customers
          WHERE id = ${dto.customerId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedCustomers.length) {
          throw new NotFoundException(`Customer with ID "${dto.customerId}" not found`);
        }

        const lockedCustomer = lockedCustomers[0];
        if (!lockedCustomer.is_active) {
          throw new BadRequestException(`Customer "${lockedCustomer.name}" is deactivated`);
        }

        // 2. Lock and validate allocated invoices deterministically
        const invoiceUpdates: Array<{
          id: string;
          invoiceNumber: string;
          allocated: number;
          newPaidAmount: number;
          newBalanceAmount: number;
        }> = [];

        if (dto.allocations && dto.allocations.length > 0) {
          const sortedInvoiceIds = [...new Set(dto.allocations.map((a) => a.salesInvoiceId))].sort();

          const lockedInvoices = await tx.$queryRaw<
            Array<{
              id: string;
              customer_id: string;
              invoice_number: string;
              net_total: Prisma.Decimal;
              paid_amount: Prisma.Decimal;
              balance_amount: Prisma.Decimal;
              status: string;
            }>
          >`
            SELECT id, customer_id, invoice_number, net_total, paid_amount, balance_amount, status
            FROM sales_invoices
            WHERE id IN (${Prisma.join(sortedInvoiceIds)}) AND organization_id = ${organizationId}
            ORDER BY id ASC
            FOR UPDATE
          `;

          if (lockedInvoices.length !== sortedInvoiceIds.length) {
            throw new BadRequestException('One or more selected invoices were not found');
          }

          const invoiceMap = new Map(lockedInvoices.map((inv) => [inv.id, inv]));

          for (const alloc of dto.allocations) {
            const inv = invoiceMap.get(alloc.salesInvoiceId);
            if (!inv) {
              throw new NotFoundException(`Invoice ${alloc.salesInvoiceId} not found`);
            }

            if (inv.customer_id !== lockedCustomer.id) {
              throw new BadRequestException(
                `Invoice "${inv.invoice_number}" does not belong to customer "${lockedCustomer.name}"`,
              );
            }

            if (inv.status !== SalesInvoiceStatus.POSTED) {
              throw new BadRequestException(
                `Cannot allocate payment to invoice "${inv.invoice_number}" with status ${inv.status}`,
              );
            }

            const currentBalance = Number(inv.balance_amount);
            const currentPaid = Number(inv.paid_amount);

            if (alloc.amountAllocated > currentBalance + 0.001) {
              throw new BadRequestException(
                `Allocated amount (Rs. ${alloc.amountAllocated.toFixed(2)}) exceeds outstanding balance (Rs. ${currentBalance.toFixed(2)}) for invoice "${inv.invoice_number}"`,
              );
            }

            const newPaid = Math.round((currentPaid + alloc.amountAllocated) * 100) / 100;
            const newBal = Math.max(0, Math.round((currentBalance - alloc.amountAllocated) * 100) / 100);

            invoiceUpdates.push({
              id: inv.id,
              invoiceNumber: inv.invoice_number,
              allocated: alloc.amountAllocated,
              newPaidAmount: newPaid,
              newBalanceAmount: newBal,
            });
          }

          // Apply invoice updates
          for (const upd of invoiceUpdates) {
            await tx.salesInvoice.update({
              where: { id: upd.id },
              data: {
                paidAmount: new Prisma.Decimal(upd.newPaidAmount),
                balanceAmount: new Prisma.Decimal(upd.newBalanceAmount),
              },
            });
          }
        }

        // 3. Atomically generate document number (DocumentType.PAYMENT_RECEIPT)
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.PAYMENT_RECEIPT,
          branchId,
        );
        const paymentNumber = numberResult.documentNumber;

        // 4. Create CustomerPayment Header
        const payment = await tx.customerPayment.create({
          data: {
            organizationId,
            branchId,
            customerId: lockedCustomer.id,
            paymentNumber,
            paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
            paymentMethod: dto.paymentMethod,
            amount: new Prisma.Decimal(dto.amount),
            allocatedAmount: new Prisma.Decimal(totalAllocated),
            unallocatedAmount: new Prisma.Decimal(unallocatedAmount),
            referenceNumber: dto.referenceNumber || null,
            bankName: dto.bankName || null,
            chequeDate: dto.chequeDate ? new Date(dto.chequeDate) : null,
            notes: dto.notes || null,
            status: CustomerPaymentStatus.POSTED,
            postedByUserId: userId || null,
          },
        });

        // 5. Create Allocation rows
        if (dto.allocations && dto.allocations.length > 0) {
          for (const alloc of dto.allocations) {
            await tx.customerPaymentAllocation.create({
              data: {
                customerPaymentId: payment.id,
                salesInvoiceId: alloc.salesInvoiceId,
                amountAllocated: new Prisma.Decimal(alloc.amountAllocated),
              },
            });
          }
        }

        // 6. Customer Sub-Ledger Entry
        const previousBalance = Number(lockedCustomer.current_balance);
        // currentBalance > 0: Customer owes money (Debit). Payment reduces balance (Credit).
        const newCustomerBalance = Math.round((previousBalance - dto.amount) * 100) / 100;

        let allocationSummary = '';
        if (invoiceUpdates.length > 0) {
          allocationSummary = ` (Allocated: ${invoiceUpdates.map((i) => `${i.invoiceNumber}: Rs. ${i.allocated}`).join(', ')}${unallocatedAmount > 0 ? `, Advance: Rs. ${unallocatedAmount}` : ''})`;
        } else {
          allocationSummary = ` (Unallocated Advance: Rs. ${dto.amount})`;
        }

        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId,
            customerId: lockedCustomer.id,
            customerPaymentId: payment.id,
            entryType: CustomerLedgerEntryType.PAYMENT,
            referenceNumber: paymentNumber,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(dto.amount),
            runningBalance: new Prisma.Decimal(newCustomerBalance),
            notes: `Customer payment receipt ${paymentNumber}${dto.referenceNumber ? ` [Ref: ${dto.referenceNumber}]` : ''}${allocationSummary}`,
            createdByUserId: userId || null,
          },
        });

        // 7. Update Customer Cached Balance
        await tx.customer.update({
          where: { id: lockedCustomer.id },
          data: {
            currentBalance: new Prisma.Decimal(newCustomerBalance),
          },
        });

        return payment;
      },
      { timeout: 15000 },
    );
  }

  /**
   * Cancels/voids a posted payment receipt and recalculates ground-truth invoice settlement balances.
   */
  async cancelPayment(id: string, dto: CancelCustomerPaymentDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Fetch payment with allocations
        const payment = await tx.customerPayment.findFirst({
          where: { id, organizationId },
          include: {
            allocations: true,
          },
        });

        if (!payment) {
          throw new NotFoundException(`Customer payment with ID "${id}" not found`);
        }

        if (payment.status === CustomerPaymentStatus.CANCELLED) {
          throw new ConflictException(
            `Payment receipt "${payment.paymentNumber}" is already cancelled`,
          );
        }

        // 2. Lock customer row with FOR UPDATE
        const lockedCustomers = await tx.$queryRaw<Array<{ id: string; current_balance: Prisma.Decimal; name: string }>>`
          SELECT id, current_balance, name FROM customers
          WHERE id = ${payment.customerId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedCustomers.length) {
          throw new NotFoundException(`Customer associated with payment not found`);
        }
        const lockedCustomer = lockedCustomers[0];

        // 3. Ground Truth Settlement Recalculation for all allocated invoices
        if (payment.allocations.length > 0) {
          const sortedInvoiceIds = [...new Set(payment.allocations.map((a) => a.salesInvoiceId))].sort();

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
            WHERE id IN (${Prisma.join(sortedInvoiceIds)}) AND organization_id = ${organizationId}
            ORDER BY id ASC
            FOR UPDATE
          `;

          for (const inv of lockedInvoices) {
            // A. Fetch valid checkout payments
            const checkoutPayments = await tx.salesInvoicePayment.findMany({
              where: { salesInvoiceId: inv.id },
            });
            const checkoutPaid = checkoutPayments.reduce(
              (sum, p) => sum + Number(p.amount),
              0,
            );

            // B. Fetch other active standalone payment allocations (excluding current cancelled payment)
            const otherAllocations = await tx.customerPaymentAllocation.findMany({
              where: {
                salesInvoiceId: inv.id,
                customerPaymentId: { not: payment.id },
                customerPayment: {
                  status: CustomerPaymentStatus.POSTED,
                },
              },
            });
            const otherPaid = otherAllocations.reduce(
              (sum, a) => sum + Number(a.amountAllocated),
              0,
            );

            // C. Fetch active sales return credits
            const activeReturns = await tx.salesReturn.findMany({
              where: {
                salesInvoiceId: inv.id,
                status: 'POSTED',
              },
            });
            // Each return credit note portion that offset invoice = netTotal - refundAmount
            const returnCredit = activeReturns.reduce(
              (sum, r) => sum + (Number(r.netTotal) - Number(r.refundAmount)),
              0,
            );

            const netTotal = Number(inv.net_total);
            const totalDirectPayments = Math.round((checkoutPaid + otherPaid) * 100) / 100;
            const totalEffectiveCredits = Math.round((totalDirectPayments + returnCredit) * 100) / 100;

            const recalculatedBalance = Math.max(
              0,
              Math.round((netTotal - totalEffectiveCredits) * 100) / 100,
            );
            const recalculatedPaid = Math.max(
              0,
              Math.round((netTotal - recalculatedBalance) * 100) / 100,
            );

            await tx.salesInvoice.update({
              where: { id: inv.id },
              data: {
                paidAmount: new Prisma.Decimal(recalculatedPaid),
                balanceAmount: new Prisma.Decimal(recalculatedBalance),
              },
            });
          }
        }

        // 4. Mark CustomerPayment as CANCELLED
        const updatedPayment = await tx.customerPayment.update({
          where: { id: payment.id },
          data: {
            status: CustomerPaymentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledByUserId: userId || null,
            cancellationReason: dto.cancellationReason,
          },
        });

        // 5. Customer Ledger Entry (Reversal: Debit receivable addition)
        const previousBalance = Number(lockedCustomer.current_balance);
        const paymentAmount = Number(payment.amount);
        const newCustomerBalance = Math.round((previousBalance + paymentAmount) * 100) / 100;

        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId: payment.branchId,
            customerId: lockedCustomer.id,
            customerPaymentId: payment.id,
            entryType: CustomerLedgerEntryType.ADJUSTMENT,
            referenceNumber: payment.paymentNumber,
            debit: new Prisma.Decimal(paymentAmount),
            credit: new Prisma.Decimal(0),
            runningBalance: new Prisma.Decimal(newCustomerBalance),
            notes: `Payment receipt ${payment.paymentNumber} cancelled/voided: ${dto.cancellationReason}`,
            createdByUserId: userId || null,
          },
        });

        // 6. Update Customer Cached Balance
        await tx.customer.update({
          where: { id: lockedCustomer.id },
          data: {
            currentBalance: new Prisma.Decimal(newCustomerBalance),
          },
        });

        // 7. Audit Log
        await this.audit.log({
          userId,
          action: 'CANCEL_CUSTOMER_PAYMENT',
          entity: 'CUSTOMER_PAYMENT',
          entityId: payment.id,
          details: {
            paymentNumber: payment.paymentNumber,
            amount: paymentAmount,
            cancellationReason: dto.cancellationReason,
          },
        });

        return updatedPayment;
      },
      { timeout: 15000 },
    );
  }

  /**
   * Retrieves paginated list of customer payments.
   */
  async findAll(query: QueryCustomerPaymentDto) {
    const organizationId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerPaymentWhereInput = { organizationId };

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.paymentMethod) {
      where.paymentMethod = query.paymentMethod;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.startDate || query.endDate) {
      where.paymentDate = {};
      if (query.startDate) {
        where.paymentDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.paymentDate.lte = new Date(query.endDate);
      }
    }

    if (query.search) {
      where.OR = [
        { paymentNumber: { contains: query.search, mode: 'insensitive' } },
        { referenceNumber: { contains: query.search, mode: 'insensitive' } },
        { bankName: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
        { customer: { code: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [items, total, aggregateSum] = await Promise.all([
      this.prisma.customerPayment.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              phone: true,
              currentBalance: true,
            },
          },
          postedByUser: {
            select: {
              id: true,
              displayName: true,
              username: true,
            },
          },
          cancelledByUser: {
            select: {
              id: true,
              displayName: true,
              username: true,
            },
          },
          allocations: {
            include: {
              salesInvoice: {
                select: {
                  id: true,
                  invoiceNumber: true,
                  netTotal: true,
                  balanceAmount: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.customerPayment.count({ where }),
      this.prisma.customerPayment.aggregate({
        where,
        _sum: {
          amount: true,
          allocatedAmount: true,
          unallocatedAmount: true,
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
        totalAmount: aggregateSum._sum.amount || 0,
        totalAllocated: aggregateSum._sum.allocatedAmount || 0,
        totalUnallocated: aggregateSum._sum.unallocatedAmount || 0,
      },
    };
  }

  /**
   * Retrieves full details of a single customer payment receipt.
   */
  async findOne(id: string) {
    const organizationId = await this.getOrganizationId();

    const payment = await this.prisma.customerPayment.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            city: true,
            phone: true,
            address: true,
          },
        },
        postedByUser: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        cancelledByUser: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        allocations: {
          include: {
            salesInvoice: {
              select: {
                id: true,
                invoiceNumber: true,
                invoiceDate: true,
                netTotal: true,
                paidAmount: true,
                balanceAmount: true,
                status: true,
              },
            },
          },
        },
        ledgerEntries: true,
      },
    });

    if (!payment) {
      throw new NotFoundException(`Customer payment with ID "${id}" not found`);
    }

    return payment;
  }
}
