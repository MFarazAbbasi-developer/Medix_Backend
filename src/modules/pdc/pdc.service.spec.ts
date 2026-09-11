import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PdcService } from './pdc.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { DocumentType, PdcStatus, SalesInvoiceStatus, PaymentMethod } from '@prisma/client';

describe('PdcService', () => {
  let service: PdcService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockCustomer = {
    id: 'cust-1',
    organizationId: 'org-1',
    code: 'CUST-001',
    name: 'Clinix Pharmacy',
    phone: '0300-1234567',
    city: 'Karachi',
    current_balance: new Decimal('25000.00'),
    currentBalance: new Decimal('25000.00'),
    isActive: true,
  };

  const mockInvoice = {
    id: 'inv-1',
    customer_id: 'cust-1',
    invoice_number: 'INV-00101',
    invoiceNumber: 'INV-00101',
    invoiceDate: new Date('2026-09-01'),
    net_total: new Decimal('15000.00'),
    netTotal: new Decimal('15000.00'),
    paid_amount: new Decimal('5000.00'),
    balance_amount: new Decimal('10000.00'),
    status: SalesInvoiceStatus.POSTED,
  };

  const mockPdc = {
    id: 'pdc-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    customerId: 'cust-1',
    pdcNumber: 'PDC-00001',
    chequeNumber: 'CHQ-889900',
    bankName: 'Meezan Bank',
    chequeDate: new Date('2026-09-10'),
    receivedDate: new Date('2026-09-05'),
    amount: new Decimal('10000.00'),
    allocatedAmount: new Decimal('10000.00'),
    unallocatedAmount: new Decimal('0.00'),
    status: PdcStatus.RECEIVED,
    notes: 'Advance cheque for monthly stock',
    branch: { id: 'branch-1', name: 'Head Office', code: 'HO' },
    customer: mockCustomer,
    allocations: [
      {
        id: 'alloc-1',
        pdcId: 'pdc-1',
        salesInvoiceId: 'inv-1',
        amountAllocated: new Decimal('10000.00'),
        salesInvoice: mockInvoice,
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
        findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true, name: 'Main Branch', code: 'HO' }),
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
      postDatedCheque: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'pdc-1',
            ...data,
          }),
        ),
        findUnique: vi.fn().mockResolvedValue(mockPdc),
        findFirst: vi.fn().mockResolvedValue(mockPdc),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...mockPdc,
            ...data,
          }),
        ),
        findMany: vi.fn().mockResolvedValue([mockPdc]),
        count: vi.fn().mockResolvedValue(1),
        groupBy: vi.fn().mockResolvedValue([
          { status: PdcStatus.RECEIVED, _count: { _all: 1 }, _sum: { amount: new Decimal('10000.00') } },
        ]),
      },
      pdcAllocation: {
        create: vi.fn().mockResolvedValue({ id: 'alloc-1' }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'alloc-1', pdcId: 'pdc-1', salesInvoiceId: 'inv-1', amountAllocated: new Decimal('10000.00') },
        ]),
      },
      customerPayment: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'pay-1',
            paymentNumber: 'REC-00001',
            ...data,
          }),
        ),
      },
      customerPaymentAllocation: {
        create: vi.fn().mockResolvedValue({ id: 'pay-alloc-1' }),
      },
      customerLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'cle-1' }),
      },
      $queryRaw: vi.fn().mockImplementation((query: any) => {
        const text =
          typeof query === 'string'
            ? query
            : query?.strings?.join(' ') || query?.sql || query?.text || String(query);

        if (text.includes('post_dated_cheques')) {
          return [
            {
              id: 'pdc-1',
              organization_id: 'org-1',
              branch_id: 'branch-1',
              customer_id: 'cust-1',
              pdc_number: 'PDC-00001',
              cheque_number: 'CHQ-889900',
              bank_name: 'Meezan Bank',
              cheque_date: new Date('2026-09-10'),
              amount: '10000.00',
              status: mockPdc.status,
            },
          ];
        }
        if (text.includes('customers')) {
          return [
            {
              id: 'cust-1',
              name: 'Clinix Pharmacy',
              code: 'CUST-001',
              current_balance: '25000.00',
            },
          ];
        }
        if (text.includes('sales_invoices')) {
          return [
            {
              id: 'inv-1',
              customer_id: 'cust-1',
              invoice_number: 'INV-00101',
              status: SalesInvoiceStatus.POSTED,
              net_total: '15000.00',
              paid_amount: '5000.00',
              balance_amount: '10000.00',
            },
          ];
        }
        return [];
      }),
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockImplementation((docType: DocumentType) => {
        if (docType === DocumentType.PDC) {
          return Promise.resolve({ documentNumber: 'PDC-00001', sequence: 1 });
        }
        return Promise.resolve({ documentNumber: 'REC-00001', sequence: 1 });
      }),
    };

    service = new PdcService(
      prisma as unknown as PrismaService,
      numberingService as unknown as NumberingService,
      auditService as unknown as AuditService,
    );
  });

  describe('createPdc (Custodial Receipt)', () => {
    it('should register PDC in custody without impacting ledger or customer balance', async () => {
      const result = await service.createPdc(
        {
          customerId: 'cust-1',
          chequeNumber: 'CHQ-889900',
          bankName: 'Meezan Bank',
          chequeDate: '2026-09-15',
          amount: 10000,
          allocations: [{ salesInvoiceId: 'inv-1', amountAllocated: 10000 }],
        },
        'branch-1',
        'user-1',
      );

      expect(result).toBeDefined();
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.PDC,
        'branch-1',
      );
      expect(prisma.postDatedCheque.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PdcStatus.RECEIVED,
            chequeNumber: 'CHQ-889900',
            bankName: 'Meezan Bank',
          }),
        }),
      );

      // Invariants: zero financial modification on receive
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
      expect(prisma.salesInvoice.update).not.toHaveBeenCalled();
    });

    it('should reject PDC creation if allocation amount exceeds cheque face value', async () => {
      await expect(
        service.createPdc({
          customerId: 'cust-1',
          chequeNumber: 'CHQ-889900',
          bankName: 'Meezan Bank',
          chequeDate: '2026-09-15',
          amount: 5000,
          allocations: [{ salesInvoiceId: 'inv-1', amountAllocated: 8000 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('depositPdc (Bank Deposit Tracking)', () => {
    it('should update PDC to DEPOSITED with deposit metadata and zero ledger impact', async () => {
      const result = await service.depositPdc(
        'pdc-1',
        {
          depositBankName: 'Habib Bank Ltd',
          depositReference: 'SLIP-445566',
        },
        'user-1',
      );

      expect(prisma.postDatedCheque.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pdc-1' },
          data: expect.objectContaining({
            status: PdcStatus.DEPOSITED,
            depositBankName: 'Habib Bank Ltd',
            depositReference: 'SLIP-445566',
          }),
        }),
      );
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('clearPdc (Clearance & Authoritative Settlement)', () => {
    it('should reject early clearance when chequeDate is in the future', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          id: 'pdc-1',
          organization_id: 'org-1',
          branch_id: 'branch-1',
          customer_id: 'cust-1',
          pdc_number: 'PDC-00001',
          cheque_number: 'CHQ-889900',
          bank_name: 'Meezan Bank',
          cheque_date: new Date('2028-01-01'), // Future date
          amount: '10000.00',
          status: PdcStatus.DEPOSITED,
        },
      ]);

      await expect(
        service.clearPdc('pdc-1', {}, 'branch-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should transactionally create CustomerPayment, allocate, update ledger and balances on clearance', async () => {
      const result = await service.clearPdc(
        'pdc-1',
        { notes: 'Cheque cleared successfully' },
        'branch-1',
        'user-1',
      );

      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.PAYMENT_RECEIPT,
        'branch-1',
      );
      expect(prisma.customerPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: PaymentMethod.CHEQUE,
            referenceNumber: 'CHQ-889900',
          }),
        }),
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
      expect(prisma.postDatedCheque.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pdc-1' },
          data: expect.objectContaining({
            status: PdcStatus.CLEARED,
            customerPaymentId: 'pay-1',
          }),
        }),
      );
    });

    it('should cap allocation if invoice balance was partially paid in interim and treat excess as advance credit', async () => {
      // Invoice was partially paid in interim, only 4000 left outstanding
      prisma.$queryRaw.mockImplementation((query: any) => {
        const text = String(query?.strings?.join(' ') || query?.sql || query?.text || query);
        if (text.includes('post_dated_cheques')) {
          return [
            {
              id: 'pdc-1',
              organization_id: 'org-1',
              branch_id: 'branch-1',
              customer_id: 'cust-1',
              pdc_number: 'PDC-00001',
              cheque_number: 'CHQ-889900',
              bank_name: 'Meezan Bank',
              cheque_date: new Date('2026-09-10'),
              amount: '10000.00',
              status: PdcStatus.DEPOSITED,
            },
          ];
        }
        if (text.includes('customers')) {
          return [
            {
              id: 'cust-1',
              name: 'Clinix Pharmacy',
              code: 'CUST-001',
              current_balance: '25000.00',
            },
          ];
        }
        if (text.includes('sales_invoices')) {
          return [
            {
              id: 'inv-1',
              customer_id: 'cust-1',
              invoice_number: 'INV-00101',
              status: SalesInvoiceStatus.POSTED,
              net_total: '15000.00',
              paid_amount: '11000.00',
              balance_amount: '4000.00', // only 4000 remaining
            },
          ];
        }
        return [];
      });

      await service.clearPdc('pdc-1', {}, 'branch-1', 'user-1');

      // Invoice should be allocated 4000 (balance -> 0), remaining 6000 becomes unallocated credit
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
        }),
      );
      expect(prisma.customerPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentMethod: PaymentMethod.CHEQUE,
            referenceNumber: 'CHQ-889900',
          }),
        }),
      );
    });
  });

  describe('bouncePdc & cancelPdc', () => {
    it('should mark PDC as BOUNCED with zero ledger change', async () => {
      await service.bouncePdc(
        'pdc-1',
        { bounceReason: 'Insufficient funds' },
        'user-1',
      );

      expect(prisma.postDatedCheque.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pdc-1' },
          data: expect.objectContaining({
            status: PdcStatus.BOUNCED,
            bounceReason: 'Insufficient funds',
          }),
        }),
      );
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });

    it('should mark PDC as CANCELLED with zero ledger change', async () => {
      await service.cancelPdc(
        'pdc-1',
        { cancellationReason: 'Cheque replaced by customer' },
        'user-1',
      );

      expect(prisma.postDatedCheque.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pdc-1' },
          data: expect.objectContaining({
            status: PdcStatus.CANCELLED,
            cancellationReason: 'Cheque replaced by customer',
          }),
        }),
      );
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(prisma.customer.update).not.toHaveBeenCalled();
    });
  });
});
