import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SupplierPaymentService } from './supplier-payment.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { DocumentType, SupplierPaymentStatus, GrnStatus, PaymentMethod } from '@prisma/client';

describe('SupplierPaymentService', () => {
  let service: SupplierPaymentService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockSupplier = {
    id: 'sup-1',
    organizationId: 'org-1',
    name: 'Getz Pharma Distribution',
    current_balance: new Decimal('25000.00'),
    is_active: true,
  };

  const mockGrn = {
    id: 'grn-1',
    supplierId: 'sup-1',
    supplier_id: 'sup-1',
    grnNumber: 'GRN-00001',
    grn_number: 'GRN-00001',
    netTotal: new Decimal('20000.00'),
    net_total: new Decimal('20000.00'),
    paidAmount: new Decimal('5000.00'),
    paid_amount: new Decimal('5000.00'),
    balanceAmount: new Decimal('15000.00'),
    balance_amount: new Decimal('15000.00'),
    status: GrnStatus.POSTED,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      supplier: {
        findFirst: vi.fn().mockResolvedValue(mockSupplier),
        update: vi.fn().mockResolvedValue(mockSupplier),
      },
      goodsReceiveNote: {
        findMany: vi.fn().mockResolvedValue([mockGrn]),
        findFirst: vi.fn().mockResolvedValue(mockGrn),
        update: vi.fn().mockResolvedValue(mockGrn),
      },
      supplierPayment: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'pay-1',
            ...data,
          }),
        ),
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay-1',
          paymentNumber: 'REC-00001',
          supplierId: 'sup-1',
          branchId: 'branch-1',
          amount: new Decimal('15000.00'),
          status: SupplierPaymentStatus.POSTED,
          allocations: [{ grnId: 'grn-1', amountAllocated: new Decimal('15000.00') }],
        }),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'pay-1',
            paymentNumber: 'REC-00001',
            ...data,
          }),
        ),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: {
            amount: new Decimal('15000.00'),
            allocatedAmount: new Decimal('15000.00'),
            unallocatedAmount: new Decimal('0.00'),
          },
        }),
      },
      supplierPaymentAllocation: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      purchaseReturn: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      supplierLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'sle-1' }),
      },
      $queryRaw: vi.fn().mockImplementation((query: any) => {
        const text =
          typeof query === 'string'
            ? query
            : query?.strings
            ? query.strings.join(' ')
            : JSON.stringify(query);

        if (text.includes('FROM suppliers') || text.includes('FROM "suppliers"')) {
          return Promise.resolve([mockSupplier]);
        }
        if (text.includes('FROM goods_receive_notes') || text.includes('FROM "goods_receive_notes"')) {
          return Promise.resolve([mockGrn]);
        }
        return Promise.resolve([]);
      }),
      $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(true),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({ documentNumber: 'PAY-00001' }),
    };

    service = new SupplierPaymentService(prisma, auditService, numberingService);
  });

  describe('createPayment', () => {
    it('creates a posted supplier payment and allocates to GRN successfully', async () => {
      const result = await service.createPayment({
        supplierId: 'sup-1',
        paymentMethod: PaymentMethod.BANK_TRANSFER,
        amount: 15000,
        allocations: [{ grnId: 'grn-1', amountAllocated: 15000 }],
        referenceNumber: 'TXN-99881',
      });

      expect(result).toBeDefined();
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.PAYMENT_RECEIPT,
        'branch-1',
      );
      expect(prisma.goodsReceiveNote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'grn-1' },
        }),
      );
      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'sup-1',
            entryType: 'PAYMENT',
          }),
        }),
      );
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sup-1' },
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_SUPPLIER_PAYMENT',
          entity: 'SUPPLIER_PAYMENT',
        }),
      );
    });

    it('rejects allocation exceeding GRN outstanding balance', async () => {
      await expect(
        service.createPayment({
          supplierId: 'sup-1',
          paymentMethod: PaymentMethod.CASH,
          amount: 25000,
          allocations: [{ grnId: 'grn-1', amountAllocated: 20000 }], // outstanding is 15000
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when total allocated exceeds payment amount', async () => {
      await expect(
        service.createPayment({
          supplierId: 'sup-1',
          paymentMethod: PaymentMethod.CASH,
          amount: 5000,
          allocations: [{ grnId: 'grn-1', amountAllocated: 10000 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('supports unallocated advance supplier payment', async () => {
      const result = await service.createPayment({
        supplierId: 'sup-1',
        paymentMethod: PaymentMethod.CASH,
        amount: 10000,
      });

      expect(result).toBeDefined();
      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'sup-1',
            entryType: 'PAYMENT',
          }),
        }),
      );
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sup-1' },
        }),
      );
    });
  });

  describe('cancelPayment', () => {
    it('cancels supplier payment and recalculates ground-truth GRN settlement correctly', async () => {
      const result = await service.cancelPayment('pay-1', {
        cancellationReason: 'Disbursed against wrong vendor account',
      });

      expect(result).toBeDefined();
      expect(prisma.supplierPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-1' },
          data: expect.objectContaining({
            status: SupplierPaymentStatus.CANCELLED,
            cancellationReason: 'Disbursed against wrong vendor account',
          }),
        }),
      );
      expect(prisma.goodsReceiveNote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'grn-1' },
        }),
      );
      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: 'ADJUSTMENT',
          }),
        }),
      );
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sup-1' },
        }),
      );
    });

    it('rejects cancellation if payment is already cancelled', async () => {
      prisma.supplierPayment.findFirst.mockResolvedValueOnce({
        id: 'pay-1',
        paymentNumber: 'PAY-00001',
        status: SupplierPaymentStatus.CANCELLED,
      });

      await expect(
        service.cancelPayment('pay-1', {
          cancellationReason: 'Repeat cancel',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('getUnpaidGrns', () => {
    it('returns unpaid posted GRNs for the given supplier', async () => {
      const result = await service.getUnpaidGrns('sup-1');
      expect(result).toHaveLength(1);
      expect(result[0].grnNumber).toBe('GRN-00001');
    });
  });
});
