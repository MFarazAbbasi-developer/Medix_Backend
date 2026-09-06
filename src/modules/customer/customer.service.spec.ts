import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomerService } from './customer.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('CustomerService', () => {
  let service: CustomerService;
  let prisma: any;
  let auditService: any;

  const mockCustomer = {
    id: 'cust-1',
    organizationId: 'org-1',
    code: 'CUST-001',
    name: 'Al-Shifa Pharmacy',
    customerType: 'RETAIL_PHARMACY',
    contactPerson: 'Tariq Mehmood',
    phone: '03001234567',
    currentBalance: new Decimal('5000.00'),
    creditLimit: new Decimal('100000.00'),
    creditDays: 30,
    defaultDiscountPercentage: new Decimal('5.00'),
    isTaxExempt: false,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue(mockCustomer),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([mockCustomer]),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockResolvedValue(mockCustomer),
        update: vi.fn().mockResolvedValue(mockCustomer),
      },
      customerLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'entry-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { debit: new Decimal('5000.00'), credit: new Decimal('0.00') },
        }),
      },
      customerPricingRule: {
        findMany: vi.fn().mockResolvedValue([]),
        upsert: vi.fn().mockResolvedValue({ id: 'rule-1' }),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: 'prod-1', name: 'Panadol' }),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new CustomerService(prisma as PrismaService, auditService as AuditService);
  });

  it('creates customer and logs opening balance when provided', async () => {
    const res = await service.createCustomer(
      {
        code: 'CUST-001',
        name: 'Al-Shifa Pharmacy',
        creditDays: 30,
        creditLimit: 100000,
        openingBalance: 5000,
      },
      'user-1',
    );

    expect(prisma.customer.create).toHaveBeenCalled();
    expect(prisma.customerLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: 'OPENING_BALANCE',
          debit: expect.any(Object),
        }),
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_CUSTOMER' }),
    );
    expect(res).toBeDefined();
  });

  it('prevents creating duplicate customer code in same organization', async () => {
    prisma.customer.findUnique.mockResolvedValueOnce(mockCustomer);

    await expect(
      service.createCustomer(
        {
          code: 'CUST-001',
          name: 'Duplicate Pharmacy',
        },
        'user-1',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('updates customer details successfully', async () => {
    const updated = await service.updateCustomer(
      'cust-1',
      {
        name: 'Al-Shifa Super Pharmacy',
        creditLimit: 150000,
      },
      'user-1',
    );

    expect(prisma.customer.update).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'UPDATE_CUSTOMER' }),
    );
    expect(updated).toBeDefined();
  });

  it('throws NotFoundException when updating non-existent customer', async () => {
    prisma.customer.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateCustomer('non-existent', { name: 'Test' }, 'user-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('retrieves customer ledger with aggregated balance summaries', async () => {
    const ledger = await service.getCustomerLedger('cust-1', { page: 1, limit: 10 });

    expect(ledger.customer).toBeDefined();
    expect(ledger.summary.totalDebit).toBe(5000);
    expect(ledger.summary.netBalance).toBe(5000);
  });
});
