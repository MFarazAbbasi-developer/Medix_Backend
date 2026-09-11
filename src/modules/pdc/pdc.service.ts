import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import {
  DocumentType,
  PdcStatus,
  SalesInvoiceStatus,
  CustomerPaymentStatus,
  CustomerLedgerEntryType,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { CreatePdcDto } from './dto/create-pdc.dto';
import { DepositPdcDto } from './dto/deposit-pdc.dto';
import { ClearPdcDto } from './dto/clear-pdc.dto';
import { BouncePdcDto } from './dto/bounce-pdc.dto';
import { CancelPdcDto } from './dto/cancel-pdc.dto';
import { QueryPdcDto } from './dto/query-pdc.dto';

@Injectable()
export class PdcService {
  private readonly logger = new Logger(PdcService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not configured');
    }
    return org.id;
  }

  /**
   * Registers a newly received Post-Dated Cheque into custody.
   * Zero financial ledger, invoice balance, or customer balance changes occur at this stage.
   */
  async createPdc(dto: CreatePdcDto, branchId?: string, userId?: string) {
    const organizationId = await this.getOrganizationId();

    // 1. Resolve branch if not explicitly provided
    let resolvedBranchId = branchId;
    if (!resolvedBranchId) {
      const defaultBranch = await this.prisma.branch.findFirst({
        where: { organizationId, isActive: true },
        orderBy: [{ isHeadOffice: 'desc' }, { createdAt: 'asc' }],
      });
      if (!defaultBranch) {
        throw new BadRequestException('No active branch found');
      }
      resolvedBranchId = defaultBranch.id;
    }

    // 2. Validate customer
    const customer = await this.prisma.customer.findFirst({
      where: { id: dto.customerId, organizationId, isActive: true },
    });
    if (!customer) {
      throw new NotFoundException(`Active customer "${dto.customerId}" not found`);
    }

    // 3. Validate pre-allocations if provided
    let totalAllocated = 0;
    if (dto.allocations && dto.allocations.length > 0) {
      totalAllocated = dto.allocations.reduce((sum, a) => sum + a.amountAllocated, 0);
      totalAllocated = Math.round(totalAllocated * 100) / 100;

      if (totalAllocated > dto.amount + 0.001) {
        throw new BadRequestException(
          `Total pre-allocated amount (Rs. ${totalAllocated.toFixed(2)}) cannot exceed PDC amount (Rs. ${dto.amount.toFixed(2)})`,
        );
      }

      const invoiceIds = dto.allocations.map((a) => a.salesInvoiceId);
      const invoices = await this.prisma.salesInvoice.findMany({
        where: {
          id: { in: invoiceIds },
          organizationId,
          customerId: customer.id,
        },
      });

      if (invoices.length !== invoiceIds.length) {
        throw new BadRequestException('One or more pre-allocated invoices do not exist or belong to a different customer');
      }

      for (const inv of invoices) {
        if (inv.status !== SalesInvoiceStatus.POSTED) {
          throw new BadRequestException(
            `Cannot allocate PDC to invoice "${inv.invoiceNumber}" with status ${inv.status}. Only POSTED invoices can be allocated.`,
          );
        }
      }
    }

    const unallocatedAmount = Math.max(0, Math.round((dto.amount - totalAllocated) * 100) / 100);

    return this.prisma.$transaction(
      async (tx) => {
        // Generate sequential PDC Document Number
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.PDC,
          resolvedBranchId,
        );
        const pdcNumber = numberResult.documentNumber;

        const pdc = await tx.postDatedCheque.create({
          data: {
            organizationId,
            branchId: resolvedBranchId,
            customerId: customer.id,
            pdcNumber,
            chequeNumber: dto.chequeNumber.trim(),
            bankName: dto.bankName.trim(),
            chequeDate: new Date(dto.chequeDate),
            receivedDate: dto.receivedDate ? new Date(dto.receivedDate) : new Date(),
            amount: new Prisma.Decimal(dto.amount),
            allocatedAmount: new Prisma.Decimal(totalAllocated),
            unallocatedAmount: new Prisma.Decimal(unallocatedAmount),
            status: PdcStatus.RECEIVED,
            notes: dto.notes?.trim() || null,
            createdById: userId || null,
          },
        });

        // Create pre-allocation records
        if (dto.allocations && dto.allocations.length > 0) {
          for (const alloc of dto.allocations) {
            await tx.pdcAllocation.create({
              data: {
                pdcId: pdc.id,
                salesInvoiceId: alloc.salesInvoiceId,
                amountAllocated: new Prisma.Decimal(alloc.amountAllocated),
              },
            });
          }
        }

        // Audit log
        await this.auditService.log({
          userId,
          action: 'PDC_RECEIVED',
          entity: 'PostDatedCheque',
          entityId: pdc.id,
          details: {
            pdcNumber,
            chequeNumber: dto.chequeNumber,
            bankName: dto.bankName,
            chequeDate: dto.chequeDate,
            amount: dto.amount,
            customerName: customer.name,
            customerCode: customer.code,
          },
        });

        return tx.postDatedCheque.findUnique({
          where: { id: pdc.id },
          include: {
            customer: true,
            branch: true,
            allocations: {
              include: {
                salesInvoice: {
                  select: {
                    id: true,
                    invoiceNumber: true,
                    invoiceDate: true,
                    netTotal: true,
                    balanceAmount: true,
                  },
                },
              },
            },
          },
        });
      },
      { timeout: 15000 },
    );
  }

  /**
   * Records bank deposit details for a received PDC.
   * Zero financial ledger or customer balance impact.
   */
  async depositPdc(id: string, dto: DepositPdcDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // Row-lock PDC
        const lockedPdcs: Array<{
          id: string;
          status: PdcStatus;
          pdc_number: string;
          cheque_number: string;
          amount: string;
        }> = await tx.$queryRaw`
          SELECT id, status, pdc_number, cheque_number, amount::text
          FROM post_dated_cheques
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedPdcs.length) {
          throw new NotFoundException(`Post-Dated Cheque ${id} not found`);
        }

        const pdc = lockedPdcs[0];

        if (pdc.status !== PdcStatus.RECEIVED) {
          throw new BadRequestException(
            `Cannot deposit PDC "${pdc.pdc_number}" because its status is ${pdc.status}. Only RECEIVED cheques can be marked as DEPOSITED.`,
          );
        }

        const depositedAt = dto.depositedAt ? new Date(dto.depositedAt) : new Date();

        const updated = await tx.postDatedCheque.update({
          where: { id },
          data: {
            status: PdcStatus.DEPOSITED,
            depositBankName: dto.depositBankName.trim(),
            depositReference: dto.depositReference?.trim() || null,
            depositedAt,
            depositedByUserId: userId || null,
          },
          include: {
            customer: true,
            branch: true,
            allocations: {
              include: {
                salesInvoice: true,
              },
            },
          },
        });

        await this.auditService.log({
          userId,
          action: 'PDC_DEPOSITED',
          entity: 'PostDatedCheque',
          entityId: id,
          details: {
            pdcNumber: pdc.pdc_number,
            chequeNumber: pdc.cheque_number,
            depositBankName: dto.depositBankName,
            depositReference: dto.depositReference,
            depositedAt: depositedAt.toISOString(),
          },
        });

        return updated;
      },
      { timeout: 15000 },
    );
  }

  /**
   * Executes authoritative clearance of a Post-Dated Cheque.
   * Transactionally creates CustomerPayment, applies re-evaluated allocations, updates invoice balances,
   * creates CustomerLedgerEntry, and updates customer currentBalance.
   */
  async clearPdc(id: string, dto: ClearPdcDto, branchId?: string, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Row-lock PDC
        const lockedPdcs: Array<{
          id: string;
          organization_id: string;
          branch_id: string;
          customer_id: string;
          pdc_number: string;
          cheque_number: string;
          bank_name: string;
          cheque_date: Date;
          amount: string;
          status: PdcStatus;
        }> = await tx.$queryRaw`
          SELECT id, organization_id, branch_id, customer_id, pdc_number, cheque_number, bank_name, cheque_date, amount::text, status
          FROM post_dated_cheques
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedPdcs.length) {
          throw new NotFoundException(`Post-Dated Cheque ${id} not found`);
        }

        const pdc = lockedPdcs[0];

        if (pdc.status !== PdcStatus.RECEIVED && pdc.status !== PdcStatus.DEPOSITED) {
          throw new BadRequestException(
            `Cannot clear PDC "${pdc.pdc_number}" with status ${pdc.status}. Only RECEIVED or DEPOSITED cheques can be cleared.`,
          );
        }

        // 2. Strict business date validation: chequeDate <= current business date
        const now = new Date();
        const chequeDate = new Date(pdc.cheque_date);
        // Normalize to date component for strict calendar day comparison
        const todayDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        if (chequeDate > todayDateOnly) {
          throw new BadRequestException(
            `Cannot clear PDC "${pdc.pdc_number}" before its maturity date (${chequeDate.toISOString().split('T')[0]}). Early clearance is not permitted.`,
          );
        }

        // 3. Row-lock Customer
        const lockedCustomers: Array<{
          id: string;
          name: string;
          code: string;
          current_balance: string;
        }> = await tx.$queryRaw`
          SELECT id, name, code, current_balance::text
          FROM customers
          WHERE id = ${pdc.customer_id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedCustomers.length) {
          throw new NotFoundException('Associated customer not found');
        }

        const customer = lockedCustomers[0];
        const pdcAmount = Number(pdc.amount);

        // 4. Fetch pre-allocations
        const preAllocations = await tx.pdcAllocation.findMany({
          where: { pdcId: pdc.id },
        });

        const invoiceUpdates: Array<{
          id: string;
          invoiceNumber: string;
          amountAllocated: number;
          newPaidAmount: number;
          newBalanceAmount: number;
        }> = [];

        let actualAllocatedTotal = 0;

        if (preAllocations.length > 0) {
          const invoiceIds = Array.from(new Set(preAllocations.map((a) => a.salesInvoiceId))).sort();

          const lockedInvoices: Array<{
            id: string;
            customer_id: string;
            invoice_number: string;
            status: SalesInvoiceStatus;
            net_total: string;
            paid_amount: string;
            balance_amount: string;
          }> = await tx.$queryRaw`
            SELECT id, customer_id, invoice_number, status, net_total::text, paid_amount::text, balance_amount::text
            FROM sales_invoices
            WHERE id IN (${Prisma.join(invoiceIds)}) AND organization_id = ${organizationId}
            ORDER BY id ASC
            FOR UPDATE
          `;

          const invoiceMap = new Map(lockedInvoices.map((inv) => [inv.id, inv]));

          for (const alloc of preAllocations) {
            const inv = invoiceMap.get(alloc.salesInvoiceId);
            if (!inv) {
              continue; // Invoice was deleted or invalid; skip
            }

            if (inv.customer_id !== customer.id || inv.status !== SalesInvoiceStatus.POSTED) {
              continue; // Not eligible for settlement; skip
            }

            const currentBal = Number(inv.balance_amount);
            const currentPaid = Number(inv.paid_amount);

            // Revalidation: Cap allocation to remaining balance on the invoice so we NEVER over-allocate
            const requestedAlloc = Number(alloc.amountAllocated);
            const effectiveAlloc = Math.min(requestedAlloc, currentBal);

            if (effectiveAlloc > 0) {
              const newPaid = Math.round((currentPaid + effectiveAlloc) * 100) / 100;
              const newBal = Math.max(0, Math.round((currentBal - effectiveAlloc) * 100) / 100);

              invoiceUpdates.push({
                id: inv.id,
                invoiceNumber: inv.invoice_number,
                amountAllocated: effectiveAlloc,
                newPaidAmount: newPaid,
                newBalanceAmount: newBal,
              });

              actualAllocatedTotal += effectiveAlloc;
            }
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

        actualAllocatedTotal = Math.round(actualAllocatedTotal * 100) / 100;
        const unallocatedAdvance = Math.max(0, Math.round((pdcAmount - actualAllocatedTotal) * 100) / 100);

        // 5. Atomically generate DocumentType.PAYMENT_RECEIPT number
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.PAYMENT_RECEIPT,
          pdc.branch_id,
        );
        const paymentNumber = numberResult.documentNumber;

        const clearanceDate = dto.clearedAt ? new Date(dto.clearedAt) : new Date();

        // 6. Create authoritative CustomerPayment record
        const payment = await tx.customerPayment.create({
          data: {
            organizationId,
            branchId: pdc.branch_id,
            customerId: customer.id,
            paymentNumber,
            paymentDate: clearanceDate,
            paymentMethod: PaymentMethod.CHEQUE,
            amount: new Prisma.Decimal(pdcAmount),
            allocatedAmount: new Prisma.Decimal(actualAllocatedTotal),
            unallocatedAmount: new Prisma.Decimal(unallocatedAdvance),
            referenceNumber: pdc.cheque_number,
            bankName: pdc.bank_name,
            chequeDate: new Date(pdc.cheque_date),
            notes: dto.notes?.trim() || `Clearance of PDC ${pdc.pdc_number} (${pdc.cheque_number} / ${pdc.bank_name})`,
            status: CustomerPaymentStatus.POSTED,
            postedByUserId: userId || null,
          },
        });

        // 7. Create authoritative CustomerPaymentAllocation rows
        for (const upd of invoiceUpdates) {
          await tx.customerPaymentAllocation.create({
            data: {
              customerPaymentId: payment.id,
              salesInvoiceId: upd.id,
              amountAllocated: new Prisma.Decimal(upd.amountAllocated),
            },
          });
        }

        // 8. Update Customer Sub-Ledger
        const previousCustBal = Number(customer.current_balance);
        const newCustBal = Math.round((previousCustBal - pdcAmount) * 100) / 100;

        let allocationSummary = '';
        if (invoiceUpdates.length > 0) {
          allocationSummary = ` (Allocated: ${invoiceUpdates.map((i) => `${i.invoiceNumber}: Rs. ${i.amountAllocated}`).join(', ')}${unallocatedAdvance > 0 ? `, Advance: Rs. ${unallocatedAdvance}` : ''})`;
        } else {
          allocationSummary = ` (Unallocated Advance: Rs. ${pdcAmount})`;
        }

        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId: pdc.branch_id,
            customerId: customer.id,
            customerPaymentId: payment.id,
            entryType: CustomerLedgerEntryType.PAYMENT,
            referenceNumber: paymentNumber,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(pdcAmount),
            runningBalance: new Prisma.Decimal(newCustBal),
            notes: `PDC Clearance ${pdc.pdc_number} [Cheque #${pdc.cheque_number} / ${pdc.bank_name}]${allocationSummary}`,
            createdByUserId: userId || null,
          },
        });

        // 9. Update Customer cached balance
        await tx.customer.update({
          where: { id: customer.id },
          data: {
            currentBalance: new Prisma.Decimal(newCustBal),
          },
        });

        // 10. Update PostDatedCheque to CLEARED and link CustomerPayment
        const clearedPdc = await tx.postDatedCheque.update({
          where: { id: pdc.id },
          data: {
            status: PdcStatus.CLEARED,
            clearedAt: clearanceDate,
            clearedByUserId: userId || null,
            customerPaymentId: payment.id,
            allocatedAmount: new Prisma.Decimal(actualAllocatedTotal),
            unallocatedAmount: new Prisma.Decimal(unallocatedAdvance),
          },
          include: {
            customer: true,
            branch: true,
            customerPayment: {
              include: {
                allocations: {
                  include: {
                    salesInvoice: true,
                  },
                },
              },
            },
            allocations: {
              include: {
                salesInvoice: true,
              },
            },
          },
        });

        // 11. Audit Log
        await this.auditService.log({
          userId,
          action: 'PDC_CLEARED',
          entity: 'PostDatedCheque',
          entityId: pdc.id,
          details: {
            pdcNumber: pdc.pdc_number,
            chequeNumber: pdc.cheque_number,
            bankName: pdc.bank_name,
            amount: pdcAmount,
            customerPaymentId: payment.id,
            paymentNumber,
            allocatedAmount: actualAllocatedTotal,
            unallocatedAmount: unallocatedAdvance,
          },
        });

        return clearedPdc;
      },
      { timeout: 20000 },
    );
  }

  /**
   * Marks a PDC as bounced/dishonored.
   * Zero ledger modifications required (as no credit had been given prior to clearance).
   */
  async bouncePdc(id: string, dto: BouncePdcDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // Row-lock PDC
        const lockedPdcs: Array<{
          id: string;
          status: PdcStatus;
          pdc_number: string;
          cheque_number: string;
        }> = await tx.$queryRaw`
          SELECT id, status, pdc_number, cheque_number
          FROM post_dated_cheques
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedPdcs.length) {
          throw new NotFoundException(`Post-Dated Cheque ${id} not found`);
        }

        const pdc = lockedPdcs[0];

        if (pdc.status !== PdcStatus.RECEIVED && pdc.status !== PdcStatus.DEPOSITED) {
          throw new BadRequestException(
            `Cannot bounce PDC "${pdc.pdc_number}" because its status is ${pdc.status}. Only RECEIVED or DEPOSITED cheques can be marked as BOUNCED.`,
          );
        }

        const bouncedAt = dto.bouncedAt ? new Date(dto.bouncedAt) : new Date();

        const updated = await tx.postDatedCheque.update({
          where: { id },
          data: {
            status: PdcStatus.BOUNCED,
            bouncedAt,
            bouncedByUserId: userId || null,
            bounceReason: dto.bounceReason.trim(),
          },
          include: {
            customer: true,
            branch: true,
            allocations: {
              include: {
                salesInvoice: true,
              },
            },
          },
        });

        await this.auditService.log({
          userId,
          action: 'PDC_BOUNCED',
          entity: 'PostDatedCheque',
          entityId: id,
          details: {
            pdcNumber: pdc.pdc_number,
            chequeNumber: pdc.cheque_number,
            bounceReason: dto.bounceReason,
            bouncedAt: bouncedAt.toISOString(),
          },
        });

        return updated;
      },
      { timeout: 15000 },
    );
  }

  /**
   * Cancels/returns an uncleared PDC.
   * Zero ledger modifications required.
   */
  async cancelPdc(id: string, dto: CancelPdcDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // Row-lock PDC
        const lockedPdcs: Array<{
          id: string;
          status: PdcStatus;
          pdc_number: string;
          cheque_number: string;
        }> = await tx.$queryRaw`
          SELECT id, status, pdc_number, cheque_number
          FROM post_dated_cheques
          WHERE id = ${id} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedPdcs.length) {
          throw new NotFoundException(`Post-Dated Cheque ${id} not found`);
        }

        const pdc = lockedPdcs[0];

        if (pdc.status !== PdcStatus.RECEIVED && pdc.status !== PdcStatus.DEPOSITED) {
          throw new BadRequestException(
            `Cannot cancel PDC "${pdc.pdc_number}" because its status is ${pdc.status}. Only RECEIVED or DEPOSITED cheques can be cancelled.`,
          );
        }

        const cancelledAt = new Date();

        const updated = await tx.postDatedCheque.update({
          where: { id },
          data: {
            status: PdcStatus.CANCELLED,
            cancelledAt,
            cancelledByUserId: userId || null,
            cancellationReason: dto.cancellationReason.trim(),
          },
          include: {
            customer: true,
            branch: true,
            allocations: {
              include: {
                salesInvoice: true,
              },
            },
          },
        });

        await this.auditService.log({
          userId,
          action: 'PDC_CANCELLED',
          entity: 'PostDatedCheque',
          entityId: id,
          details: {
            pdcNumber: pdc.pdc_number,
            chequeNumber: pdc.cheque_number,
            cancellationReason: dto.cancellationReason,
          },
        });

        return updated;
      },
      { timeout: 15000 },
    );
  }

  /**
   * Retrieves paginated list of Post-Dated Cheques with filters and summary statistics.
   */
  async getPdcs(query: QueryPdcDto) {
    const organizationId = await this.getOrganizationId();
    const { page = 1, limit = 20, search, customerId, status, startDate, endDate, branchId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PostDatedChequeWhereInput = {
      organizationId,
    };

    if (branchId) {
      where.branchId = branchId;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.chequeDate = {};
      if (startDate) {
        where.chequeDate.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.chequeDate.lte = end;
      }
    }

    if (search && search.trim().length > 0) {
      const term = search.trim();
      where.OR = [
        { pdcNumber: { contains: term, mode: 'insensitive' } },
        { chequeNumber: { contains: term, mode: 'insensitive' } },
        { bankName: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
        { customer: { code: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [items, total, summaryRaw] = await Promise.all([
      this.prisma.postDatedCheque.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ chequeDate: 'asc' }, { createdAt: 'desc' }],
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              code: true,
              phone: true,
              city: true,
              currentBalance: true,
            },
          },
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          customerPayment: {
            select: {
              id: true,
              paymentNumber: true,
              paymentDate: true,
              amount: true,
              status: true,
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
                  balanceAmount: true,
                },
              },
            },
          },
          createdByUser: {
            select: {
              id: true,
              displayName: true,
              username: true,
            },
          },
        },
      }),
      this.prisma.postDatedCheque.count({ where }),
      this.prisma.postDatedCheque.groupBy({
        by: ['status'],
        where: { organizationId },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    const metrics = {
      receivedCount: 0,
      receivedAmount: 0,
      depositedCount: 0,
      depositedAmount: 0,
      clearedCount: 0,
      clearedAmount: 0,
      bouncedCount: 0,
      bouncedAmount: 0,
      cancelledCount: 0,
      cancelledAmount: 0,
      totalPendingAmount: 0, // RECEIVED + DEPOSITED
    };

    for (const group of summaryRaw) {
      const count = group._count._all;
      const amount = Number(group._sum.amount || 0);

      switch (group.status) {
        case PdcStatus.RECEIVED:
          metrics.receivedCount = count;
          metrics.receivedAmount = amount;
          metrics.totalPendingAmount += amount;
          break;
        case PdcStatus.DEPOSITED:
          metrics.depositedCount = count;
          metrics.depositedAmount = amount;
          metrics.totalPendingAmount += amount;
          break;
        case PdcStatus.CLEARED:
          metrics.clearedCount = count;
          metrics.clearedAmount = amount;
          break;
        case PdcStatus.BOUNCED:
          metrics.bouncedCount = count;
          metrics.bouncedAmount = amount;
          break;
        case PdcStatus.CANCELLED:
          metrics.cancelledCount = count;
          metrics.cancelledAmount = amount;
          break;
      }
    }

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      metrics,
    };
  }

  /**
   * Retrieves single PDC by ID.
   */
  async getPdcById(id: string) {
    const organizationId = await this.getOrganizationId();

    const pdc = await this.prisma.postDatedCheque.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        branch: true,
        customerPayment: {
          include: {
            allocations: {
              include: {
                salesInvoice: true,
              },
            },
          },
        },
        allocations: {
          include: {
            salesInvoice: true,
          },
        },
        createdByUser: {
          select: { id: true, displayName: true, username: true },
        },
        depositedByUser: {
          select: { id: true, displayName: true, username: true },
        },
        clearedByUser: {
          select: { id: true, displayName: true, username: true },
        },
        bouncedByUser: {
          select: { id: true, displayName: true, username: true },
        },
        cancelledByUser: {
          select: { id: true, displayName: true, username: true },
        },
      },
    });

    if (!pdc) {
      throw new NotFoundException(`Post-Dated Cheque ${id} not found`);
    }

    return pdc;
  }

  /**
   * Generates printable custody acknowledgment receipt data for a PDC.
   */
  async getPrintablePdcReceipt(id: string) {
    const pdc = await this.getPdcById(id);
    const org = await this.prisma.organization.findUnique({
      where: { id: pdc.organizationId },
    });

    return {
      organization: {
        name: org?.name || 'Medix Pharmacy',
        legalName: org?.legalName,
        address: org?.address,
        city: org?.city,
        phone: org?.phone,
        email: org?.email,
        ntn: org?.ntn,
        strn: org?.strn,
        drugSaleLicenseNo: org?.drugSaleLicenseNo,
        logoUrl: org?.logoUrl,
      },
      branch: {
        name: pdc.branch.name,
        code: pdc.branch.code,
        address: pdc.branch.address,
        phone: pdc.branch.phone,
      },
      customer: {
        name: pdc.customer.name,
        code: pdc.customer.code,
        phone: pdc.customer.phone,
        address: pdc.customer.address,
        city: pdc.customer.city,
        ntn: pdc.customer.ntn,
        currentBalance: Number(pdc.customer.currentBalance),
      },
      pdc: {
        id: pdc.id,
        pdcNumber: pdc.pdcNumber,
        chequeNumber: pdc.chequeNumber,
        bankName: pdc.bankName,
        chequeDate: pdc.chequeDate,
        receivedDate: pdc.receivedDate,
        amount: Number(pdc.amount),
        allocatedAmount: Number(pdc.allocatedAmount),
        unallocatedAmount: Number(pdc.unallocatedAmount),
        status: pdc.status,
        notes: pdc.notes,
        depositBankName: pdc.depositBankName,
        depositReference: pdc.depositReference,
        depositedAt: pdc.depositedAt,
        clearedAt: pdc.clearedAt,
        bouncedAt: pdc.bouncedAt,
        bounceReason: pdc.bounceReason,
        cancelledAt: pdc.cancelledAt,
        cancellationReason: pdc.cancellationReason,
        receivedBy: pdc.createdByUser?.displayName || 'Authorized Custodian',
        linkedPaymentNumber: pdc.customerPayment?.paymentNumber || null,
        allocations: pdc.allocations.map((a) => ({
          invoiceNumber: a.salesInvoice.invoiceNumber,
          invoiceDate: a.salesInvoice.invoiceDate,
          netTotal: Number(a.salesInvoice.netTotal),
          amountAllocated: Number(a.amountAllocated),
        })),
      },
    };
  }
}
