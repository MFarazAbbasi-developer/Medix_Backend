import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { QuerySupplierPaymentDto } from './dto/query-supplier-payment.dto';
import { CancelSupplierPaymentDto } from './dto/cancel-supplier-payment.dto';
import {
  Prisma,
  DocumentType,
  SupplierPaymentStatus,
  GrnStatus,
  SupplierLedgerEntryType,
  PurchaseReturnStatus,
} from '@prisma/client';

@Injectable()
export class SupplierPaymentService {
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
   * Retrieves all unpaid / partially-paid posted GRNs for a supplier (FIFO ordering).
   */
  async getUnpaidGrns(supplierId: string) {
    const organizationId = await this.getOrganizationId();

    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId },
    });
    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${supplierId}" not found`);
    }

    return this.prisma.goodsReceiveNote.findMany({
      where: {
        organizationId,
        supplierId,
        status: GrnStatus.POSTED,
        balanceAmount: { gt: 0 },
      },
      orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        grnNumber: true,
        supplierInvoiceNumber: true,
        supplierInvoiceDate: true,
        receivedDate: true,
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
   * Creates and posts a supplier payment voucher with multi-GRN allocation and unallocated advance support.
   */
  async createPayment(dto: CreateSupplierPaymentDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    if (dto.amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    // Validate allocations if provided
    let totalAllocated = 0;
    if (dto.allocations && dto.allocations.length > 0) {
      const grnIds = dto.allocations.map((a) => a.grnId);
      const uniqueIds = new Set(grnIds);
      if (uniqueIds.size !== grnIds.length) {
        throw new BadRequestException('Duplicate GRN IDs detected in allocation list');
      }

      for (const a of dto.allocations) {
        if (a.amountAllocated <= 0) {
          throw new BadRequestException('Allocated amount for each GRN must be greater than 0');
        }
        totalAllocated += a.amountAllocated;
      }

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
        // 1. Lock supplier row with FOR UPDATE
        const lockedSuppliers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string; is_active: boolean }>
        >`
          SELECT id, current_balance, name, is_active FROM suppliers
          WHERE id = ${dto.supplierId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedSuppliers.length) {
          throw new NotFoundException(`Supplier with ID "${dto.supplierId}" not found`);
        }

        const lockedSupplier = lockedSuppliers[0];
        if (!lockedSupplier.is_active) {
          throw new BadRequestException(`Supplier "${lockedSupplier.name}" is deactivated`);
        }

        // 2. Lock and validate allocated GRNs deterministically
        const grnUpdates: Array<{
          id: string;
          grnNumber: string;
          allocated: number;
          newPaidAmount: number;
          newBalanceAmount: number;
        }> = [];

        if (dto.allocations && dto.allocations.length > 0) {
          const sortedGrnIds = [...new Set(dto.allocations.map((a) => a.grnId))].sort();

          const lockedGrns = await tx.$queryRaw<
            Array<{
              id: string;
              supplier_id: string;
              grn_number: string;
              net_total: Prisma.Decimal;
              paid_amount: Prisma.Decimal;
              balance_amount: Prisma.Decimal;
              status: string;
            }>
          >`
            SELECT id, supplier_id, grn_number, net_total, paid_amount, balance_amount, status
            FROM goods_receive_notes
            WHERE id IN (${Prisma.join(sortedGrnIds)}) AND organization_id = ${organizationId}
            ORDER BY id ASC
            FOR UPDATE
          `;

          if (lockedGrns.length !== sortedGrnIds.length) {
            throw new BadRequestException('One or more selected GRNs were not found');
          }

          const grnMap = new Map(lockedGrns.map((g) => [g.id, g]));

          for (const alloc of dto.allocations) {
            const grn = grnMap.get(alloc.grnId);
            if (!grn) {
              throw new NotFoundException(`GRN ${alloc.grnId} not found`);
            }

            if (grn.supplier_id !== lockedSupplier.id) {
              throw new BadRequestException(
                `GRN "${grn.grn_number}" does not belong to supplier "${lockedSupplier.name}"`,
              );
            }

            if (grn.status !== GrnStatus.POSTED) {
              throw new BadRequestException(
                `Cannot allocate payment to GRN "${grn.grn_number}" with status ${grn.status}`,
              );
            }

            const currentBalance = Number(grn.balance_amount);
            const currentPaid = Number(grn.paid_amount);

            if (alloc.amountAllocated > currentBalance + 0.001) {
              throw new BadRequestException(
                `Allocated amount (Rs. ${alloc.amountAllocated.toFixed(2)}) exceeds outstanding balance (Rs. ${currentBalance.toFixed(2)}) for GRN "${grn.grn_number}"`,
              );
            }

            const newPaid = Math.round((currentPaid + alloc.amountAllocated) * 100) / 100;
            const newBal = Math.max(0, Math.round((currentBalance - alloc.amountAllocated) * 100) / 100);

            grnUpdates.push({
              id: grn.id,
              grnNumber: grn.grn_number,
              allocated: alloc.amountAllocated,
              newPaidAmount: newPaid,
              newBalanceAmount: newBal,
            });
          }

          // Apply GRN settlement updates
          for (const upd of grnUpdates) {
            await tx.goodsReceiveNote.update({
              where: { id: upd.id },
              data: {
                paidAmount: new Prisma.Decimal(upd.newPaidAmount),
                balanceAmount: new Prisma.Decimal(upd.newBalanceAmount),
              },
            });
          }
        }

        // 3. Atomically generate document number
        const numberResult = await this.numbering.generateNextNumber(
          DocumentType.PAYMENT_RECEIPT,
          branchId,
        );
        const paymentNumber = numberResult.documentNumber;

        // 4. Create SupplierPayment Header
        const payment = await tx.supplierPayment.create({
          data: {
            organizationId,
            branchId,
            supplierId: lockedSupplier.id,
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
            status: SupplierPaymentStatus.POSTED,
            postedByUserId: userId || null,
          },
        });

        // 5. Create Allocations
        if (dto.allocations && dto.allocations.length > 0) {
          await tx.supplierPaymentAllocation.createMany({
            data: dto.allocations.map((a) => ({
              supplierPaymentId: payment.id,
              grnId: a.grnId,
              amountAllocated: new Prisma.Decimal(a.amountAllocated),
            })),
          });
        }

        // 6. Supplier Sub-Ledger Entry
        // In supplier ledger: DEBIT reduces payable (we paid the supplier)
        const previousBalance = Number(lockedSupplier.current_balance);
        const paymentAmount = Number(payment.amount);
        const newSupplierBalance = Math.round((previousBalance - paymentAmount) * 100) / 100;

        await tx.supplierLedgerEntry.create({
          data: {
            organizationId,
            branchId,
            supplierId: lockedSupplier.id,
            supplierPaymentId: payment.id,
            entryType: SupplierLedgerEntryType.PAYMENT,
            referenceNumber: paymentNumber,
            debit: new Prisma.Decimal(paymentAmount),
            credit: new Prisma.Decimal(0),
            runningBalance: new Prisma.Decimal(newSupplierBalance),
            notes: `Supplier payment ${paymentNumber} via ${dto.paymentMethod}${dto.referenceNumber ? ` (Ref: ${dto.referenceNumber})` : ''}`,
            createdByUserId: userId || null,
          },
        });

        // 7. Update Supplier Cached Balance
        await tx.supplier.update({
          where: { id: lockedSupplier.id },
          data: {
            currentBalance: new Prisma.Decimal(newSupplierBalance),
          },
        });

        // 8. Audit Log
        await this.audit.log({
          userId,
          action: 'CREATE_SUPPLIER_PAYMENT',
          entity: 'SUPPLIER_PAYMENT',
          entityId: payment.id,
          details: {
            paymentNumber,
            supplierId: lockedSupplier.id,
            supplierName: lockedSupplier.name,
            amount: dto.amount,
            allocatedAmount: totalAllocated,
            unallocatedAmount,
            paymentMethod: dto.paymentMethod,
            allocationsCount: dto.allocations?.length || 0,
          },
        });

        return this.findByIdWithTx(tx, payment.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Cancels/voids a posted Supplier Payment with ground-truth GRN settlement recalculation.
   */
  async cancelPayment(id: string, dto: CancelSupplierPaymentDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(
      async (tx) => {
        // 1. Fetch payment with allocations
        const payment = await tx.supplierPayment.findFirst({
          where: { id, organizationId },
          include: {
            allocations: true,
            supplier: true,
          },
        });

        if (!payment) {
          throw new NotFoundException(`Supplier payment with ID "${id}" not found`);
        }

        if (payment.status === SupplierPaymentStatus.CANCELLED) {
          throw new ConflictException(
            `Supplier payment "${payment.paymentNumber}" is already cancelled`,
          );
        }

        // 2. Lock supplier row with FOR UPDATE
        const lockedSuppliers = await tx.$queryRaw<
          Array<{ id: string; current_balance: Prisma.Decimal; name: string }>
        >`
          SELECT id, current_balance, name
          FROM suppliers
          WHERE id = ${payment.supplierId} AND organization_id = ${organizationId}
          FOR UPDATE
        `;

        if (!lockedSuppliers.length) {
          throw new NotFoundException('Supplier associated with payment not found');
        }
        const lockedSupplier = lockedSuppliers[0];

        // 3. Ground Truth Settlement Recalculation for all allocated GRNs
        if (payment.allocations.length > 0) {
          const sortedGrnIds = [...new Set(payment.allocations.map((a) => a.grnId))].sort();

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
            WHERE id IN (${Prisma.join(sortedGrnIds)}) AND organization_id = ${organizationId}
            ORDER BY id ASC
            FOR UPDATE
          `;

          for (const grn of lockedGrns) {
            // A. Fetch other active supplier payment allocations (excluding current cancelled payment)
            const otherAllocations = await tx.supplierPaymentAllocation.findMany({
              where: {
                grnId: grn.id,
                supplierPaymentId: { not: payment.id },
                supplierPayment: {
                  status: SupplierPaymentStatus.POSTED,
                },
              },
            });
            const otherPaid = otherAllocations.reduce(
              (sum, a) => sum + Number(a.amountAllocated),
              0,
            );

            // B. Fetch active purchase return credits
            const activeReturns = await tx.purchaseReturn.findMany({
              where: {
                grnId: grn.id,
                status: PurchaseReturnStatus.POSTED,
              },
            });
            const returnCredit = activeReturns.reduce(
              (sum, r) => sum + Number(r.netTotal),
              0,
            );

            const netTotal = Number(grn.net_total);
            const totalEffectiveCredits = Math.round((otherPaid + returnCredit) * 100) / 100;

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

        // 4. Mark SupplierPayment as CANCELLED
        await tx.supplierPayment.update({
          where: { id: payment.id },
          data: {
            status: SupplierPaymentStatus.CANCELLED,
            cancelledAt: new Date(),
            cancelledByUserId: userId || null,
            cancellationReason: dto.cancellationReason,
          },
        });

        // 5. Supplier Ledger Entry (Reversal: Credit increases payable back)
        const previousBalance = Number(lockedSupplier.current_balance);
        const paymentAmount = Number(payment.amount);
        const newSupplierBalance = Math.round((previousBalance + paymentAmount) * 100) / 100;

        await tx.supplierLedgerEntry.create({
          data: {
            organizationId,
            branchId: payment.branchId,
            supplierId: lockedSupplier.id,
            supplierPaymentId: payment.id,
            entryType: SupplierLedgerEntryType.ADJUSTMENT,
            referenceNumber: payment.paymentNumber,
            debit: new Prisma.Decimal(0),
            credit: new Prisma.Decimal(paymentAmount),
            runningBalance: new Prisma.Decimal(newSupplierBalance),
            notes: `Supplier payment ${payment.paymentNumber} cancelled/voided: ${dto.cancellationReason}`,
            createdByUserId: userId || null,
          },
        });

        // 6. Update Supplier Cached Balance
        await tx.supplier.update({
          where: { id: lockedSupplier.id },
          data: {
            currentBalance: new Prisma.Decimal(newSupplierBalance),
          },
        });

        // 7. Audit Log
        await this.audit.log({
          userId,
          action: 'CANCEL_SUPPLIER_PAYMENT',
          entity: 'SUPPLIER_PAYMENT',
          entityId: payment.id,
          details: {
            paymentNumber: payment.paymentNumber,
            supplierId: lockedSupplier.id,
            amount: Number(payment.amount),
            cancellationReason: dto.cancellationReason,
          },
        });

        return this.findByIdWithTx(tx, payment.id, organizationId);
      },
      { timeout: 20000 },
    );
  }

  /**
   * Retrieves paginated supplier payments with filters and aggregates.
   */
  async findAll(query: QuerySupplierPaymentDto) {
    const organizationId = await this.getOrganizationId();
    const {
      search,
      supplierId,
      paymentMethod,
      status,
      startDate,
      endDate,
      page = 1,
      limit = 20,
    } = query;

    const where: Prisma.SupplierPaymentWhereInput = {
      organizationId,
    };

    if (supplierId) {
      where.supplierId = supplierId;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (status) {
      where.status = status;
    }

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) {
        where.paymentDate.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.paymentDate.lte = end;
      }
    }

    if (search) {
      where.OR = [
        { paymentNumber: { contains: search, mode: 'insensitive' } },
        { referenceNumber: { contains: search, mode: 'insensitive' } },
        { supplier: { name: { contains: search, mode: 'insensitive' } } },
        { supplier: { code: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, total, aggregates] = await Promise.all([
      this.prisma.supplierPayment.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
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
          postedByUser: {
            select: { id: true, displayName: true, username: true },
          },
          cancelledByUser: {
            select: { id: true, displayName: true, username: true },
          },
          _count: {
            select: { allocations: true },
          },
        },
      }),
      this.prisma.supplierPayment.count({ where }),
      this.prisma.supplierPayment.aggregate({
        where: { ...where, status: SupplierPaymentStatus.POSTED },
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
      totalPages: Math.ceil(total / limit) || 1,
      summary: {
        totalPaidAmount: aggregates._sum.amount ? Number(aggregates._sum.amount) : 0,
        totalAllocatedAmount: aggregates._sum.allocatedAmount
          ? Number(aggregates._sum.allocatedAmount)
          : 0,
        totalUnallocatedAmount: aggregates._sum.unallocatedAmount
          ? Number(aggregates._sum.unallocatedAmount)
          : 0,
      },
    };
  }

  /**
   * Retrieves full supplier payment details by ID.
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
    const payment = await tx.supplierPayment.findFirst({
      where: { id, organizationId },
      include: {
        supplier: true,
        branch: { select: { id: true, name: true, code: true } },
        postedByUser: { select: { id: true, displayName: true, username: true } },
        cancelledByUser: { select: { id: true, displayName: true, username: true } },
        allocations: {
          include: {
            grn: {
              select: {
                id: true,
                grnNumber: true,
                supplierInvoiceNumber: true,
                receivedDate: true,
                netTotal: true,
                paidAmount: true,
                balanceAmount: true,
                status: true,
              },
            },
          },
        },
        ledgerEntries: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException(`Supplier payment with ID "${id}" not found`);
    }

    return payment;
  }
}
