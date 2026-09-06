import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SupplierService } from './supplier.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('SupplierService', () => {
  let service: SupplierService;
  let prisma: any;
  let auditService: any;

  const mockOrg = { id: 'org-1', name: 'Test Org' };
  const mockSupplier = {
    id: 'sup-1',
    organizationId: 'org-1',
    code: 'SUP-001',
    name: 'Getz Pharma',
    contactPerson: 'Ali Khan',
    phone: '03001234567',
    currentBalance: new Decimal('1000.00'),
    creditLimit: new Decimal('50000.00'),
    creditDays: 30,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      supplier: {
        findFirst: vi.fn().mockResolvedValue(mockSupplier),
        findUnique: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([mockSupplier]),
        count: vi.fn().mockResolvedValue(1),
        create: vi.fn().mockResolvedValue(mockSupplier),
        update: vi.fn().mockResolvedValue(mockSupplier),
      },
      supplierLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'entry-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { debit: new Decimal('0.00'), credit: new Decimal('1000.00') },
        }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new SupplierService(prisma as PrismaService, auditService as AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a supplier and opening balance ledger entry if balance > 0', async () => {
    const result = await service.create({
      code: 'SUP-001',
      name: 'Getz Pharma',
      openingBalance: 5000,
    });

    expect(prisma.supplier.create).toHaveBeenCalled();
    expect(prisma.supplierLedgerEntry.create).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_SUPPLIER' }),
    );
    expect(result).toBeDefined();
  });

  it('should throw ConflictException if supplier code exists', async () => {
    prisma.supplier.findUnique.mockResolvedValueOnce(mockSupplier);

    await expect(
      service.create({ code: 'SUP-001', name: 'Getz Pharma' }),
    ).rejects.toThrow(ConflictException);
  });

  it('should retrieve paginated suppliers', async () => {
    const result = await service.findAll({ search: 'Getz' });
    expect(result.items).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('should retrieve supplier ledger statement', async () => {
    const result = await service.getLedger('sup-1', {});
    expect(result.supplier.id).toBe('sup-1');
    expect(result.summary).toBeDefined();
  });
});
