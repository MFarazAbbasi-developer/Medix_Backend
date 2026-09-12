import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerPaymentService } from './customer-payment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { DocumentType, CustomerPaymentStatus, SalesInvoiceStatus, PaymentMethod } from '@prisma/client';

describe('CustomerPaymentService', () => {
  let service: CustomerPaymentService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockCustomer = {
    id: 'cust-1',
    organizationId: 'org-1',
    name: 'Al-Shifa Pharmacy',
    current_balance: new Decimal('15000.00'),
    is_active: true,
  };

  const mockInvoice = {
    id: 'inv-1',
    customer_id: 'cust-1',
    invoice_number: 'INV-00001',
    net_total: new Decimal('10000.00'),
    paid_amount: new Decimal('4000.00'),
    balance_amount: new Decimal('6000.00'),
    status: SalesInvoiceStatus.POSTED,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue(mockCustomer),
        update: vi.fn().mockResolvedValue(mockCustomer),
      },
      salesInvoice: {
        findMany: vi.fn().mockResolvedValue([mockInvoice]),
        findFirst: vi.fn().mockResolvedValue(mockInvoice),
        update: vi.fn().mockResolvedValue(mockInvoice),
      },
      salesInvoicePayment: {
        findMany: vi.fn().mockResolvedValue([{ amount: new Decimal('4000.00') }]),
      },
      customerPayment: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'pay-1',
            ...data,
          }),
        ),
        findFirst: vi.fn().mockResolvedValue({
          id: 'pay-1',
          paymentNumber: 'REC-00001',
          customerId: 'cust-1',
          branchId: 'branch-1',
          amount: new Decimal('6000.00'),
          status: CustomerPaymentStatus.POSTED,
          allocations: [{ salesInvoiceId: 'inv-1', amountAllocated: new Decimal('6000.00') }],
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
            amount: new Decimal('6000.00'),
            allocatedAmount: new Decimal('6000.00'),
            unallocatedAmount: new Decimal('0.00'),
          },
        }),
      },
      customerPaymentAllocation: {
        create: vi.fn().mockResolvedValue({ id: 'alloc-1' }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      salesReturn: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      customerLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'cle-1' }),
      },
      tillSession: {
        findFirst: vi.fn().mockResolvedValue({ id: 'till-session-1', status: 'OPEN' }),
      },
      $queryRaw: vi.fn().mockImplementation((query: any) => {
        const text =
          typeof query === 'string'
            ? query
            : query?.strings?.join(' ') || query?.sql || query?.text || String(query);
        if (text.includes('customers')) {
          return [mockCustomer];
        }
        if (text.includes('sales_invoices')) {
          return [mockInvoice];
        }
        return [];
      }),
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'REC-00001',
        sequence: 1,
      }),
    };

    service = new CustomerPaymentService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      numberingService as unknown as NumberingService,
    );
  });

  describe('createPayment', () => {
    it('should successfully record payment receipt and allocate to outstanding invoice', async () => {
      const result = await service.createPayment(
        {
          customerId: 'cust-1',
          paymentMethod: PaymentMethod.CASH,
          amount: 6000,
          allocations: [{ salesInvoiceId: 'inv-1', amountAllocated: 6000 }],
        },
        'user-1',
      );

      expect(result.id).toBe('pay-1');
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.PAYMENT_RECEIPT,
        'branch-1',
        expect.anything(),
      );
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
        }),
      );
      expect(prisma.customerLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            entryType: 'PAYMENT',
          }),
        }),
      );
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-1' },
        }),
      );
    });

    it('should support advance unallocated payments creating customer credit', async () => {
      const result = await service.createPayment(
        {
          customerId: 'cust-1',
          paymentMethod: PaymentMethod.BANK_TRANSFER,
          amount: 20000,
          referenceNumber: 'TXN-998822',
        },
        'user-1',
      );

      expect(result.id).toBe('pay-1');
      expect(prisma.salesInvoice.update).not.toHaveBeenCalled();
      expect(prisma.customerPaymentAllocation.create).not.toHaveBeenCalled();
      expect(prisma.customer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'cust-1' },
        }),
      );
    });

    it('should reject payment if allocated amount exceeds invoice balance', async () => {
      await expect(
        service.createPayment({
          customerId: 'cust-1',
          paymentMethod: PaymentMethod.CASH,
          amount: 8000,
          allocations: [{ salesInvoiceId: 'inv-1', amountAllocated: 8000 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject payment if total allocations exceed payment amount', async () => {
      await expect(
        service.createPayment({
          customerId: 'cust-1',
          paymentMethod: PaymentMethod.CASH,
          amount: 3000,
          allocations: [{ salesInvoiceId: 'inv-1', amountAllocated: 5000 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject payment with duplicate invoice allocation IDs', async () => {
      await expect(
        service.createPayment({
          customerId: 'cust-1',
          paymentMethod: PaymentMethod.CASH,
          amount: 4000,
          allocations: [
            { salesInvoiceId: 'inv-1', amountAllocated: 2000 },
            { salesInvoiceId: 'inv-1', amountAllocated: 2000 },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelPayment', () => {
    it('should cancel payment and recalculate ground-truth invoice balance', async () => {
      const result = await service.cancelPayment(
        'pay-1',
        { cancellationReason: 'Wrong cheque deposited' },
        'user-1',
      );

      expect(result.status).toBe(CustomerPaymentStatus.CANCELLED);
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
        }),
      );
      expect(prisma.customerLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            entryType: 'ADJUSTMENT',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CANCEL_CUSTOMER_PAYMENT',
        }),
      );
    });

    it('should reject cancellation of an already cancelled payment', async () => {
      prisma.customerPayment.findFirst.mockResolvedValueOnce({
        id: 'pay-1',
        paymentNumber: 'REC-00001',
        status: CustomerPaymentStatus.CANCELLED,
        allocations: [],
      });

      await expect(
        service.cancelPayment('pay-1', { cancellationReason: 'Duplicate attempt' }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
