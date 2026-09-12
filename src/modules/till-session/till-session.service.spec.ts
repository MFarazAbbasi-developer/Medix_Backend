import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TillSessionService } from './till-session.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TillSessionStatus, TillMovementType, ReturnRefundMode } from '@prisma/client';

describe('TillSessionService', () => {
  let service: TillSessionService;
  let mockPrisma: any;
  let mockNumbering: any;
  let mockAudit: any;

  beforeEach(() => {
    mockPrisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'br-1', name: 'Main Branch' }),
      },
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: '500' }), // default Rs. 500 threshold
      },
      tillSession: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
      tillSessionMovement: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
      },
      tillSessionDenomination: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        deleteMany: vi.fn(),
      },
      salesInvoicePayment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      customerPayment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      salesReturn: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn(async (cb: any) => cb(mockPrisma)),
      $queryRaw: vi.fn(),
    };

    mockNumbering = {
      generateNextNumber: vi.fn().mockResolvedValue({ documentNumber: 'CS-00001' }),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(true),
    };

    service = new TillSessionService(mockPrisma, mockNumbering, mockAudit);
  });

  it('opens a new till session with opening float and sequential numbering', async () => {
    mockPrisma.tillSession.findFirst.mockResolvedValueOnce(null); // no active session
    mockPrisma.tillSession.create.mockResolvedValueOnce({
      id: 'session-1',
      sessionNumber: 'CS-00001',
      openingCash: 2500,
      status: TillSessionStatus.OPEN,
      cashierUser: { id: 'user-1', displayName: 'Cashier Ali' },
    });

    const result = await service.openSession(
      { openingCash: 2500, stationName: 'Counter 1' },
      'user-1',
      'br-1',
    );

    expect(result.sessionNumber).toBe('CS-00001');
    expect(mockPrisma.tillSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          stationName: 'Counter 1',
          status: TillSessionStatus.OPEN,
        }),
      }),
    );
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TILL_SESSION_OPEN' }),
    );
  });

  it('blocks opening a second active session for the same user in the branch', async () => {
    mockPrisma.tillSession.findFirst.mockResolvedValueOnce({
      id: 'existing-1',
      sessionNumber: 'CS-00001',
      status: TillSessionStatus.OPEN,
    });

    await expect(
      service.openSession({ openingCash: 1000 }, 'user-1', 'br-1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('records cash-in and cash-out movements on an OPEN session', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'session-1', status: TillSessionStatus.OPEN, session_number: 'CS-00001' },
    ]);
    mockPrisma.tillSessionMovement.create.mockResolvedValueOnce({
      id: 'mov-1',
      amount: 500,
      movementType: TillMovementType.CASH_IN,
      reason: 'Additional change from vault',
      performedBy: { id: 'user-1', displayName: 'Cashier Ali' },
    });

    const result = await service.recordMovement(
      'session-1',
      {
        movementType: TillMovementType.CASH_IN,
        amount: 500,
        reason: 'Additional change from vault',
      },
      'user-1',
    );

    expect(result.amount).toBe(500);
    expect(mockPrisma.tillSessionMovement.create).toHaveBeenCalled();
  });

  it('blocks cash-in/out on COUNTED or CLOSED sessions', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'session-1', status: TillSessionStatus.COUNTED, session_number: 'CS-00001' },
    ]);

    await expect(
      service.recordMovement(
        'session-1',
        {
          movementType: TillMovementType.CASH_OUT,
          amount: 200,
          reason: 'Safe drop',
        },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('computes live derived expected cash strictly from session-linked records', async () => {
    mockPrisma.tillSession.findFirst.mockResolvedValueOnce({
      id: 'session-1',
      status: TillSessionStatus.OPEN,
      openingCash: 1000,
      cashierUser: { id: 'user-1', username: 'ali', displayName: 'Ali' },
      movements: [],
      denominations: [],
    });

    mockPrisma.salesInvoicePayment.findMany
      .mockResolvedValueOnce([{ amount: 5000 }, { amount: 3000 }]) // cash sales = 8000
      .mockResolvedValueOnce([{ amount: 2000, paymentMethod: 'CREDIT_CARD' }]); // non-cash card = 2000

    mockPrisma.customerPayment.findMany.mockResolvedValueOnce([{ amount: 1500 }]); // cash collection = 1500
    mockPrisma.salesReturn.findMany.mockResolvedValueOnce([{ refundAmount: 500 }]); // cash refund = 500
    mockPrisma.tillSessionMovement.findMany.mockResolvedValueOnce([
      { amount: 1000, movementType: TillMovementType.CASH_IN }, // cash-in = 1000
      { amount: 2000, movementType: TillMovementType.CASH_OUT }, // cash-out = 2000
    ]);

    // Expected = 1000 (opening) + 8000 (sales) + 1500 (collections) + 1000 (in) - 500 (refunds) - 2000 (out) = 9000
    const active = await service.getActiveSession('user-1', 'br-1');
    expect(active?.expectedCash).toBe(9000);
    expect(active?.cashSalesAmount).toBe(8000);
    expect(active?.cardSalesAmount).toBe(2000);
  });

  it('requires a variance reason when actual cash differs from expected cash on close', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'session-1', status: TillSessionStatus.OPEN, opening_cash: 1000, session_number: 'CS-00001', user_id: 'user-1' },
    ]);
    mockPrisma.salesInvoicePayment.findMany
      .mockResolvedValueOnce([{ amount: 4000 }]) // cash sales = 4000
      .mockResolvedValueOnce([]);
    mockPrisma.customerPayment.findMany.mockResolvedValueOnce([]);
    mockPrisma.salesReturn.findMany.mockResolvedValueOnce([]);
    mockPrisma.tillSessionMovement.findMany.mockResolvedValueOnce([]);

    // Expected = 1000 + 4000 = 5000. Actual = 4800. Shortage = -200.
    await expect(
      service.closeSession(
        'session-1',
        { actualCash: 4800, varianceReason: '' }, // empty reason
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('blocks closing when variance exceeds threshold without cash_sessions.approve_variance permission', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'session-1', status: TillSessionStatus.OPEN, opening_cash: 1000, session_number: 'CS-00001', user_id: 'user-1' },
    ]);
    mockPrisma.salesInvoicePayment.findMany
      .mockResolvedValueOnce([{ amount: 4000 }]) // cash sales = 4000
      .mockResolvedValueOnce([]);
    mockPrisma.customerPayment.findMany.mockResolvedValueOnce([]);
    mockPrisma.salesReturn.findMany.mockResolvedValueOnce([]);
    mockPrisma.tillSessionMovement.findMany.mockResolvedValueOnce([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValueOnce({ value: '500' });

    // Expected = 5000. Actual = 4000. Variance = -1000 (exceeds threshold 500).
    await expect(
      service.closeSession(
        'session-1',
        { actualCash: 4000, varianceReason: 'Shortage due to counting discrepancy' },
        'user-1',
        ['cash_sessions.close'], // missing approve_variance permission
        ['CASHIER'],
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows closing when variance exceeds threshold if supervisor permission is present', async () => {
    mockPrisma.$queryRaw.mockResolvedValueOnce([
      { id: 'session-1', status: TillSessionStatus.OPEN, opening_cash: 1000, session_number: 'CS-00001', user_id: 'user-1' },
    ]);
    mockPrisma.salesInvoicePayment.findMany
      .mockResolvedValueOnce([{ amount: 4000 }])
      .mockResolvedValueOnce([]);
    mockPrisma.customerPayment.findMany.mockResolvedValueOnce([]);
    mockPrisma.salesReturn.findMany.mockResolvedValueOnce([]);
    mockPrisma.tillSessionMovement.findMany.mockResolvedValueOnce([]);
    mockPrisma.systemSetting.findUnique.mockResolvedValueOnce({ value: '500' });
    mockPrisma.tillSession.update.mockResolvedValueOnce({
      id: 'session-1',
      status: TillSessionStatus.CLOSED,
      varianceAmount: -1000,
    });

    const result = await service.closeSession(
      'session-1',
      { actualCash: 4000, varianceReason: 'Shortage approved by supervisor' },
      'user-1',
      ['cash_sessions.close', 'cash_sessions.approve_variance'],
      ['SUPERVISOR'],
    );

    expect(result.status).toBe(TillSessionStatus.CLOSED);
    expect(mockPrisma.tillSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TillSessionStatus.CLOSED,
          varianceAmount: expect.any(Object),
        }),
      }),
    );
  });

  it('preserves immutable historical values after session is CLOSED even if query is made later', async () => {
    mockPrisma.tillSession.findFirst.mockResolvedValueOnce({
      id: 'session-closed-1',
      status: TillSessionStatus.CLOSED,
      openingCash: 1000,
      cashSalesAmount: 5000,
      expectedCash: 6000,
      actualCash: 6000,
      varianceAmount: 0,
      cashierUser: { id: 'user-1', displayName: 'Ali' },
      movements: [],
      denominations: [],
    });

    const session = await service.getSessionById('session-closed-1');
    expect(session.status).toBe(TillSessionStatus.CLOSED);
    expect(Number(session.expectedCash)).toBe(6000);
    // Verified that computeSessionLiveTotals is NOT called for closed sessions
    expect(mockPrisma.salesInvoicePayment.findMany).not.toHaveBeenCalled();
  });
});
