import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { OpenTillSessionDto } from './dto/open-till-session.dto';
import { RecordTillMovementDto } from './dto/record-movement.dto';
import { CountTillSessionDto } from './dto/count-till-session.dto';
import { CloseTillSessionDto } from './dto/close-till-session.dto';
import { QueryTillSessionDto } from './dto/query-till-session.dto';
import {
  DocumentType,
  Prisma,
  TillSessionStatus,
  TillMovementType,
  SalesInvoiceStatus,
  CustomerPaymentStatus,
  SalesReturnStatus,
  ReturnRefundMode,
} from '@prisma/client';

@Injectable()
export class TillSessionService {
  private readonly logger = new Logger(TillSessionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
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

  private async getDefaultBranchId(organizationId: string): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { organizationId, isActive: true },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException('No active branch found in organization');
    }
    return branch.id;
  }

  /**
   * Helper to recalculate live derived cash and non-cash totals for an active session.
   */
  async computeSessionLiveTotals(sessionId: string, tx?: Prisma.TransactionClient) {
    const client = tx || this.prisma;

    const [
      cashSalePayments,
      nonCashSalePayments,
      cashCustomerPayments,
      cashReturns,
      cashMovements,
    ] = await Promise.all([
      // 1. Cash Sales tenders (from POSTED sales invoices)
      client.salesInvoicePayment.findMany({
        where: {
          tillSessionId: sessionId,
          paymentMethod: 'CASH',
          salesInvoice: { status: SalesInvoiceStatus.POSTED },
        },
        select: { amount: true },
      }),

      // 2. Non-cash sales tenders (for tender breakdown summary)
      client.salesInvoicePayment.findMany({
        where: {
          tillSessionId: sessionId,
          paymentMethod: { not: 'CASH' },
          salesInvoice: { status: SalesInvoiceStatus.POSTED },
        },
        select: { amount: true, paymentMethod: true },
      }),

      // 3. Cash Customer Payments (from POSTED receipts)
      client.customerPayment.findMany({
        where: {
          tillSessionId: sessionId,
          paymentMethod: 'CASH',
          status: CustomerPaymentStatus.POSTED,
        },
        select: { amount: true },
      }),

      // 4. Cash Returns Refunds (from POSTED returns)
      client.salesReturn.findMany({
        where: {
          tillSessionId: sessionId,
          refundMode: ReturnRefundMode.CASH_REFUND,
          status: SalesReturnStatus.POSTED,
        },
        select: { refundAmount: true },
      }),

      // 5. Till Movements (CASH_IN and CASH_OUT)
      client.tillSessionMovement.findMany({
        where: { tillSessionId: sessionId },
        select: { amount: true, movementType: true },
      }),
    ]);

    const cashSalesAmount = cashSalePayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const cashPaymentsAmount = cashCustomerPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const cashRefundsAmount = cashReturns.reduce((sum, r) => sum + Number(r.refundAmount), 0);

    let cashInAmount = 0;
    let cashOutAmount = 0;
    for (const m of cashMovements) {
      if (m.movementType === TillMovementType.CASH_IN) {
        cashInAmount += Number(m.amount);
      } else if (m.movementType === TillMovementType.CASH_OUT) {
        cashOutAmount += Number(m.amount);
      }
    }

    let cardSalesAmount = 0;
    let bankSalesAmount = 0;
    let chequeSalesAmount = 0;
    let creditSalesAmount = 0;

    for (const p of nonCashSalePayments) {
      const amt = Number(p.amount);
      if (p.paymentMethod === 'CREDIT_CARD') cardSalesAmount += amt;
      else if (p.paymentMethod === 'BANK_TRANSFER' || p.paymentMethod === 'ONLINE') bankSalesAmount += amt;
      else if (p.paymentMethod === 'CHEQUE') chequeSalesAmount += amt;
      else if (p.paymentMethod === 'CREDIT_ACCOUNT') creditSalesAmount += amt;
    }

    return {
      cashSalesAmount: Math.round(cashSalesAmount * 100) / 100,
      cashPaymentsAmount: Math.round(cashPaymentsAmount * 100) / 100,
      cashRefundsAmount: Math.round(cashRefundsAmount * 100) / 100,
      cashInAmount: Math.round(cashInAmount * 100) / 100,
      cashOutAmount: Math.round(cashOutAmount * 100) / 100,
      cardSalesAmount: Math.round(cardSalesAmount * 100) / 100,
      bankSalesAmount: Math.round(bankSalesAmount * 100) / 100,
      chequeSalesAmount: Math.round(chequeSalesAmount * 100) / 100,
      creditSalesAmount: Math.round(creditSalesAmount * 100) / 100,
    };
  }

  /**
   * Retrieves the currently active OPEN or COUNTED till session for the user in the branch.
   */
  async getActiveSession(userId: string, branchId?: string) {
    const organizationId = await this.getOrganizationId();
    const effectiveBranchId = branchId || (await this.getDefaultBranchId(organizationId));

    const session = await this.prisma.tillSession.findFirst({
      where: {
        organizationId,
        branchId: effectiveBranchId,
        userId,
        status: { in: [TillSessionStatus.OPEN, TillSessionStatus.COUNTED] },
      },
      include: {
        cashierUser: { select: { id: true, username: true, displayName: true } },
        approvedByUser: { select: { id: true, username: true, displayName: true } },
        closedByUser: { select: { id: true, username: true, displayName: true } },
        movements: {
          include: {
            performedBy: { select: { id: true, username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        denominations: {
          orderBy: { denominationValue: 'desc' },
        },
      },
    });

    if (!session) {
      return null;
    }

    // If session is OPEN, compute live derived values
    if (session.status === TillSessionStatus.OPEN) {
      const live = await this.computeSessionLiveTotals(session.id);
      const opening = Number(session.openingCash);
      const expectedCash = Math.round(
        (opening + live.cashSalesAmount + live.cashPaymentsAmount + live.cashInAmount - live.cashRefundsAmount - live.cashOutAmount) *
          100,
      ) / 100;

      return {
        ...session,
        cashSalesAmount: live.cashSalesAmount,
        cashPaymentsAmount: live.cashPaymentsAmount,
        cashRefundsAmount: live.cashRefundsAmount,
        cashInAmount: live.cashInAmount,
        cashOutAmount: live.cashOutAmount,
        expectedCash,
        cardSalesAmount: live.cardSalesAmount,
        bankSalesAmount: live.bankSalesAmount,
        chequeSalesAmount: live.chequeSalesAmount,
        creditSalesAmount: live.creditSalesAmount,
        actualCash: session.actualCash ? Number(session.actualCash) : null,
        varianceAmount: session.actualCash ? Math.round((Number(session.actualCash) - expectedCash) * 100) / 100 : null,
      };
    }

    // If COUNTED or CLOSED, return frozen / stored values
    return session;
  }

  /**
   * Opens a new Till Session with an initial opening cash float.
   */
  async openSession(dto: OpenTillSessionDto, userId: string, branchId?: string) {
    const organizationId = await this.getOrganizationId();
    const effectiveBranchId = branchId || (await this.getDefaultBranchId(organizationId));

    if (dto.openingCash < 0) {
      throw new BadRequestException('Opening cash float must be greater than or equal to 0');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Verify no existing active session exists for user in branch
      const existing = await tx.tillSession.findFirst({
        where: {
          organizationId,
          branchId: effectiveBranchId,
          userId,
          status: { in: [TillSessionStatus.OPEN, TillSessionStatus.COUNTED] },
        },
      });

      if (existing) {
        throw new BadRequestException(
          `User already has an active till session (${existing.sessionNumber} - ${existing.status}). Please count and close the existing session before opening a new one.`,
        );
      }

      // 2. Generate sequential session document number (DocumentType.TILL_SESSION)
      const numResult = await this.numbering.generateNextNumber(
        DocumentType.TILL_SESSION,
        effectiveBranchId,
        tx,
      );
      const sessionNumber = numResult.documentNumber;

      const openingCash = Math.round(dto.openingCash * 100) / 100;

      // 3. Create TillSession record
      const session = await tx.tillSession.create({
        data: {
          organizationId,
          branchId: effectiveBranchId,
          userId,
          sessionNumber,
          stationName: dto.stationName?.trim() || null,
          status: TillSessionStatus.OPEN,
          openedAt: new Date(),
          openingCash: new Prisma.Decimal(openingCash),
          expectedCash: new Prisma.Decimal(openingCash),
          notes: dto.notes?.trim() || null,
        },
        include: {
          cashierUser: { select: { id: true, username: true, displayName: true } },
        },
      });

      // 4. Audit Log
      await this.audit.log({
        userId,
        action: 'TILL_SESSION_OPEN',
        entity: 'TillSession',
        entityId: session.id,
        details: {
          sessionNumber,
          stationName: session.stationName,
          openingCash,
        },
      });

      return session;
    });
  }

  /**
   * Records an intra-day cash-in or cash-out till movement.
   */
  async recordMovement(sessionId: string, dto: RecordTillMovementDto, userId: string) {
    const organizationId = await this.getOrganizationId();

    if (dto.amount <= 0) {
      throw new BadRequestException('Cash movement amount must be greater than 0');
    }
    if (!dto.reason || !dto.reason.trim()) {
      throw new BadRequestException('A reason is mandatory for all cash-in and cash-out movements');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock session row FOR UPDATE
      const [session] = await tx.$queryRaw<Array<{ id: string; status: TillSessionStatus; session_number: string }>>`
        SELECT id, status, session_number FROM till_sessions
        WHERE id = ${sessionId} AND organization_id = ${organizationId}
        FOR UPDATE
      `;

      if (!session) {
        throw new NotFoundException(`Till session with ID "${sessionId}" not found`);
      }

      if (session.status !== TillSessionStatus.OPEN) {
        throw new BadRequestException(
          `Cannot record cash movements for a session in "${session.status}" status. Only OPEN sessions accept cash adjustments.`,
        );
      }

      const amount = Math.round(dto.amount * 100) / 100;

      // 2. Create TillSessionMovement
      const movement = await tx.tillSessionMovement.create({
        data: {
          tillSessionId: session.id,
          movementType: dto.movementType,
          amount: new Prisma.Decimal(amount),
          reason: dto.reason.trim(),
          referenceNo: dto.referenceNo?.trim() || null,
          performedById: userId,
        },
        include: {
          performedBy: { select: { id: true, username: true, displayName: true } },
        },
      });

      // 3. Audit Log
      await this.audit.log({
        userId,
        action: `TILL_MOVEMENT_${dto.movementType}`,
        entity: 'TillSessionMovement',
        entityId: movement.id,
        details: {
          sessionId: session.id,
          sessionNumber: session.session_number,
          movementType: dto.movementType,
          amount,
          reason: dto.reason,
        },
      });

      return movement;
    });
  }

  /**
   * Records physical cash count (denominations & total) and transitions session from OPEN to COUNTED.
   */
  async countSession(sessionId: string, dto: CountTillSessionDto, userId: string) {
    const organizationId = await this.getOrganizationId();

    if (dto.actualCash < 0) {
      throw new BadRequestException('Actual physical cash count must be greater than or equal to 0');
    }

    return this.prisma.$transaction(async (tx) => {
      const [session] = await tx.$queryRaw<Array<{ id: string; status: TillSessionStatus; opening_cash: Prisma.Decimal; session_number: string }>>`
        SELECT id, status, opening_cash, session_number FROM till_sessions
        WHERE id = ${sessionId} AND organization_id = ${organizationId}
        FOR UPDATE
      `;

      if (!session) {
        throw new NotFoundException(`Till session with ID "${sessionId}" not found`);
      }

      if (session.status === TillSessionStatus.CLOSED) {
        throw new BadRequestException('Cannot count a session that is already CLOSED and immutable');
      }

      // Compute live totals
      const live = await this.computeSessionLiveTotals(session.id, tx);
      const opening = Number(session.opening_cash);
      const expectedCash = Math.round(
        (opening + live.cashSalesAmount + live.cashPaymentsAmount + live.cashInAmount - live.cashRefundsAmount - live.cashOutAmount) *
          100,
      ) / 100;

      const actualCash = Math.round(dto.actualCash * 100) / 100;
      const variance = Math.round((actualCash - expectedCash) * 100) / 100;

      // Replace denominations if provided
      if (dto.denominations && dto.denominations.length > 0) {
        await tx.tillSessionDenomination.deleteMany({
          where: { tillSessionId: session.id },
        });

        for (const d of dto.denominations) {
          if (d.noteCount > 0) {
            await tx.tillSessionDenomination.create({
              data: {
                tillSessionId: session.id,
                denominationValue: new Prisma.Decimal(d.denominationValue),
                noteCount: d.noteCount,
                totalAmount: new Prisma.Decimal(Math.round(d.denominationValue * d.noteCount * 100) / 100),
              },
            });
          }
        }
      }

      const updated = await tx.tillSession.update({
        where: { id: session.id },
        data: {
          status: TillSessionStatus.COUNTED,
          countedAt: new Date(),
          actualCash: new Prisma.Decimal(actualCash),
          expectedCash: new Prisma.Decimal(expectedCash),
          varianceAmount: new Prisma.Decimal(variance),
          varianceReason: dto.varianceReason?.trim() || null,
        },
        include: {
          cashierUser: { select: { id: true, username: true, displayName: true } },
          denominations: { orderBy: { denominationValue: 'desc' } },
        },
      });

      await this.audit.log({
        userId,
        action: 'TILL_SESSION_COUNT',
        entity: 'TillSession',
        entityId: session.id,
        details: {
          sessionNumber: session.session_number,
          actualCash,
          expectedCash,
          variance,
          varianceReason: dto.varianceReason,
        },
      });

      return updated;
    });
  }

  /**
   * Finalizes and closes the till session, freezing all financial totals permanently.
   */
  async closeSession(
    sessionId: string,
    dto: CloseTillSessionDto,
    userId: string,
    userPermissions?: string[],
    userRoles?: string[],
  ) {
    const organizationId = await this.getOrganizationId();

    if (dto.actualCash < 0) {
      throw new BadRequestException('Actual cash must be greater than or equal to 0');
    }

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock session row FOR UPDATE
      const [session] = await tx.$queryRaw<
        Array<{
          id: string;
          status: TillSessionStatus;
          opening_cash: Prisma.Decimal;
          session_number: string;
          user_id: string;
        }>
      >`
        SELECT id, status, opening_cash, session_number, user_id FROM till_sessions
        WHERE id = ${sessionId} AND organization_id = ${organizationId}
        FOR UPDATE
      `;

      if (!session) {
        throw new NotFoundException(`Till session with ID "${sessionId}" not found`);
      }

      if (session.status === TillSessionStatus.CLOSED) {
        throw new BadRequestException(
          `Till session "${session.session_number}" is already CLOSED and permanently immutable.`,
        );
      }

      // 2. Compute authoritative expected cash and tender breakdown strictly from session-linked records
      const live = await this.computeSessionLiveTotals(session.id, tx);
      const opening = Number(session.opening_cash);
      const expectedCash = Math.round(
        (opening + live.cashSalesAmount + live.cashPaymentsAmount + live.cashInAmount - live.cashRefundsAmount - live.cashOutAmount) *
          100,
      ) / 100;

      const actualCash = Math.round(dto.actualCash * 100) / 100;
      const variance = Math.round((actualCash - expectedCash) * 100) / 100;

      // 3. Variance validation: any non-zero variance requires a mandatory reason
      if (variance !== 0) {
        if (!dto.varianceReason || !dto.varianceReason.trim()) {
          throw new BadRequestException(
            `A variance explanation reason is mandatory for any cash shortage or excess (Current variance: Rs. ${variance.toFixed(2)}).`,
          );
        }
      }

      // 4. Threshold & Supervisor Authorization Validation
      const thresholdSetting = await tx.systemSetting.findUnique({
        where: {
          organizationId_key: {
            organizationId,
            key: 'CASH_VARIANCE_APPROVAL_THRESHOLD',
          },
        },
      });
      const threshold = thresholdSetting ? Number(thresholdSetting.value) : 500;

      let approvedByUserId: string | null = null;
      if (Math.abs(variance) > threshold) {
        const canApprove =
          userRoles?.includes('ADMIN') ||
          userPermissions?.includes('cash_sessions.approve_variance') ||
          false;

        if (!canApprove) {
          throw new ForbiddenException(
            `Cash variance of Rs. ${Math.abs(variance).toFixed(
              2,
            )} exceeds the allowed approval threshold (Rs. ${threshold.toFixed(
              2,
            )}). Supervisor authorization permission (cash_sessions.approve_variance) is required to close this session.`,
          );
        }
        approvedByUserId = dto.approvedByUserId || userId;
      } else if (variance !== 0) {
        approvedByUserId = dto.approvedByUserId || userId;
      }

      // 5. Replace denomination breakdown if provided
      if (dto.denominations && dto.denominations.length > 0) {
        await tx.tillSessionDenomination.deleteMany({
          where: { tillSessionId: session.id },
        });

        for (const d of dto.denominations) {
          if (d.noteCount > 0) {
            await tx.tillSessionDenomination.create({
              data: {
                tillSessionId: session.id,
                denominationValue: new Prisma.Decimal(d.denominationValue),
                noteCount: d.noteCount,
                totalAmount: new Prisma.Decimal(Math.round(d.denominationValue * d.noteCount * 100) / 100),
              },
            });
          }
        }
      }

      // 6. Freeze final immutable snapshots and mark CLOSED
      const closedSession = await tx.tillSession.update({
        where: { id: session.id },
        data: {
          status: TillSessionStatus.CLOSED,
          closedAt: new Date(),
          cashSalesAmount: new Prisma.Decimal(live.cashSalesAmount),
          cashPaymentsAmount: new Prisma.Decimal(live.cashPaymentsAmount),
          cashRefundsAmount: new Prisma.Decimal(live.cashRefundsAmount),
          cashInAmount: new Prisma.Decimal(live.cashInAmount),
          cashOutAmount: new Prisma.Decimal(live.cashOutAmount),
          expectedCash: new Prisma.Decimal(expectedCash),
          actualCash: new Prisma.Decimal(actualCash),
          varianceAmount: new Prisma.Decimal(variance),
          cardSalesAmount: new Prisma.Decimal(live.cardSalesAmount),
          bankSalesAmount: new Prisma.Decimal(live.bankSalesAmount),
          chequeSalesAmount: new Prisma.Decimal(live.chequeSalesAmount),
          creditSalesAmount: new Prisma.Decimal(live.creditSalesAmount),
          varianceReason: dto.varianceReason?.trim() || null,
          notes: dto.notes?.trim() || null,
          closedByUserId: userId,
          approvedByUserId,
        },
        include: {
          cashierUser: { select: { id: true, username: true, displayName: true } },
          closedByUser: { select: { id: true, username: true, displayName: true } },
          approvedByUser: { select: { id: true, username: true, displayName: true } },
          denominations: { orderBy: { denominationValue: 'desc' } },
          movements: {
            include: { performedBy: { select: { id: true, username: true, displayName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      // 7. Audit Log
      await this.audit.log({
        userId,
        action: 'TILL_SESSION_CLOSE',
        entity: 'TillSession',
        entityId: session.id,
        details: {
          sessionNumber: session.session_number,
          openingCash: opening,
          expectedCash,
          actualCash,
          variance,
          varianceReason: dto.varianceReason,
          approvedByUserId,
        },
      });

      return closedSession;
    });
  }

  /**
   * Retrieves single till session by ID.
   */
  async getSessionById(id: string) {
    const organizationId = await this.getOrganizationId();

    const session = await this.prisma.tillSession.findFirst({
      where: { id, organizationId },
      include: {
        cashierUser: { select: { id: true, username: true, displayName: true } },
        closedByUser: { select: { id: true, username: true, displayName: true } },
        approvedByUser: { select: { id: true, username: true, displayName: true } },
        movements: {
          include: {
            performedBy: { select: { id: true, username: true, displayName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        denominations: {
          orderBy: { denominationValue: 'desc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundException(`Till session with ID "${id}" not found`);
    }

    if (session.status === TillSessionStatus.OPEN) {
      const live = await this.computeSessionLiveTotals(session.id);
      const opening = Number(session.openingCash);
      const expectedCash = Math.round(
        (opening + live.cashSalesAmount + live.cashPaymentsAmount + live.cashInAmount - live.cashRefundsAmount - live.cashOutAmount) *
          100,
      ) / 100;

      return {
        ...session,
        cashSalesAmount: live.cashSalesAmount,
        cashPaymentsAmount: live.cashPaymentsAmount,
        cashRefundsAmount: live.cashRefundsAmount,
        cashInAmount: live.cashInAmount,
        cashOutAmount: live.cashOutAmount,
        expectedCash,
        cardSalesAmount: live.cardSalesAmount,
        bankSalesAmount: live.bankSalesAmount,
        chequeSalesAmount: live.chequeSalesAmount,
        creditSalesAmount: live.creditSalesAmount,
        actualCash: session.actualCash ? Number(session.actualCash) : null,
        varianceAmount: session.actualCash ? Math.round((Number(session.actualCash) - expectedCash) * 100) / 100 : null,
      };
    }

    return session;
  }

  /**
   * Paginated list of till sessions for registers and audit reports.
   */
  async getSessions(query: QueryTillSessionDto) {
    const organizationId = await this.getOrganizationId();

    const where: Prisma.TillSessionWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.startDate || query.endDate
        ? {
            openedAt: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate
                ? { lte: new Date(new Date(query.endDate).setHours(23, 59, 59, 999)) }
                : {}),
            },
          }
        : {}),
    };

    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.tillSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { openedAt: 'desc' },
        include: {
          cashierUser: { select: { id: true, username: true, displayName: true } },
          closedByUser: { select: { id: true, username: true, displayName: true } },
          approvedByUser: { select: { id: true, username: true, displayName: true } },
        },
      }),
      this.prisma.tillSession.count({ where }),
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
   * Formats printable data for 80mm thermal slip and A4 reconciliation report.
   */
  async getSessionPrintData(sessionId: string) {
    const organizationId = await this.getOrganizationId();

    const [session, org] = await Promise.all([
      this.prisma.tillSession.findFirst({
        where: { id: sessionId, organizationId },
        include: {
          branch: true,
          cashierUser: { select: { id: true, username: true, displayName: true } },
          closedByUser: { select: { id: true, username: true, displayName: true } },
          approvedByUser: { select: { id: true, username: true, displayName: true } },
          denominations: { orderBy: { denominationValue: 'desc' } },
          movements: {
            include: { performedBy: { select: { id: true, username: true, displayName: true } } },
            orderBy: { createdAt: 'asc' },
          },
        },
      }),
      this.prisma.organization.findFirst({ where: { id: organizationId } }),
    ]);

    if (!session) {
      throw new NotFoundException(`Till session with ID "${sessionId}" not found`);
    }

    return {
      company: {
        name: org?.name || 'FARMAX MEDIX',
        legalName: org?.legalName,
        address: org?.address,
        city: org?.city,
        phone: org?.phone,
        email: org?.email,
        ntn: org?.ntn,
        strn: org?.strn,
        drugSaleLicenseNo: org?.drugSaleLicenseNo,
      },
      branch: {
        name: session.branch.name,
        code: session.branch.code,
        city: session.branch.city,
        phone: session.branch.phone,
      },
      session: {
        id: session.id,
        sessionNumber: session.sessionNumber,
        stationName: session.stationName,
        status: session.status,
        openedAt: session.openedAt.toISOString(),
        countedAt: session.countedAt ? session.countedAt.toISOString() : null,
        closedAt: session.closedAt ? session.closedAt.toISOString() : null,
        cashier: {
          id: session.cashierUser.id,
          username: session.cashierUser.username,
          displayName: session.cashierUser.displayName,
        },
        closedBy: session.closedByUser
          ? {
              id: session.closedByUser.id,
              username: session.closedByUser.username,
              displayName: session.closedByUser.displayName,
            }
          : null,
        approvedBy: session.approvedByUser
          ? {
              id: session.approvedByUser.id,
              username: session.approvedByUser.username,
              displayName: session.approvedByUser.displayName,
            }
          : null,
        financials: {
          openingCash: Number(session.openingCash),
          cashSalesAmount: Number(session.cashSalesAmount),
          cashPaymentsAmount: Number(session.cashPaymentsAmount),
          cashRefundsAmount: Number(session.cashRefundsAmount),
          cashInAmount: Number(session.cashInAmount),
          cashOutAmount: Number(session.cashOutAmount),
          expectedCash: Number(session.expectedCash),
          actualCash: session.actualCash ? Number(session.actualCash) : 0,
          varianceAmount: session.varianceAmount ? Number(session.varianceAmount) : 0,
          // Non-cash breakdown
          cardSalesAmount: Number(session.cardSalesAmount),
          bankSalesAmount: Number(session.bankSalesAmount),
          chequeSalesAmount: Number(session.chequeSalesAmount),
          creditSalesAmount: Number(session.creditSalesAmount),
        },
        varianceReason: session.varianceReason,
        notes: session.notes,
        denominations: session.denominations.map((d) => ({
          denominationValue: Number(d.denominationValue),
          noteCount: d.noteCount,
          totalAmount: Number(d.totalAmount),
        })),
        movements: session.movements.map((m) => ({
          id: m.id,
          movementType: m.movementType,
          amount: Number(m.amount),
          reason: m.reason,
          referenceNo: m.referenceNo,
          performedBy: m.performedBy.displayName,
          createdAt: m.createdAt.toISOString(),
        })),
      },
    };
  }
}
