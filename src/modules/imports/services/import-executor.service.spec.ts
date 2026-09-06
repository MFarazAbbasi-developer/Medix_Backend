import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ImportExecutorService } from './import-executor.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import {
  ImportType,
  ImportJobStatus,
  StockMovementType,
  CustomerLedgerEntryType,
  SupplierLedgerEntryType,
} from '@prisma/client';

describe('ImportExecutorService', () => {
  let executorService: ImportExecutorService;
  let mockPrisma: any;
  let mockAudit: any;

  beforeEach(() => {
    mockAudit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      importJob: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn(async (cb) => {
        return cb(mockPrisma);
      }),
      $queryRaw: vi.fn().mockResolvedValue([]),
      product: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'p-new' }),
      },
      customer: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 'c-1', code: 'CUST-001', currentBalance: 1000 }),
        create: vi.fn().mockResolvedValue({ id: 'c-new' }),
        update: vi.fn().mockResolvedValue({ id: 'c-1' }),
      },
      customerLedgerEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'cle-1' }),
      },
      supplier: {
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn().mockResolvedValue({ id: 's-1', code: 'SUP-001', currentBalance: 2000 }),
        create: vi.fn().mockResolvedValue({ id: 's-new' }),
        update: vi.fn().mockResolvedValue({ id: 's-1' }),
      },
      supplierLedgerEntry: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'sle-1' }),
      },
      batch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'b-new' }),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
      },
    };

    executorService = new ImportExecutorService(
      mockPrisma as unknown as PrismaService,
      mockAudit as unknown as AuditService,
    );
  });

  it('should execute product import transactionally', async () => {
    mockPrisma.importJob.findUnique.mockResolvedValueOnce({
      id: 'job-1',
      organizationId: 'org-1',
      type: ImportType.PRODUCTS,
      status: ImportJobStatus.READY,
      totalRows: 1,
      originalFilename: 'products.csv',
      metadata: {
        parsedPayload: [
          { sku: 'MED-001', name: 'Panadol', genericName: 'Paracetamol', taxPercentage: 0 },
        ],
      },
    });
    mockPrisma.importJob.updateMany.mockResolvedValueOnce({ count: 1 });

    await executorService.executeImport('job-1', 'user-1');

    expect(mockPrisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sku: 'MED-001',
          name: 'Panadol',
        }),
      }),
    );
  });

  it('should execute opening stock import and create StockMovement ledger entries with batch lock', async () => {
    mockPrisma.importJob.findUnique.mockResolvedValueOnce({
      id: 'job-stock',
      organizationId: 'org-1',
      type: ImportType.OPENING_STOCK,
      status: ImportJobStatus.READY,
      totalRows: 1,
      originalFilename: 'stock.csv',
      metadata: {
        parsedPayload: [
          {
            productId: 'p-1',
            batchNumber: 'BN-101',
            warehouseId: 'wh-1',
            branchId: 'br-1',
            quantity: 50,
            purchaseCost: 30,
            expiryDate: '2028-01-01',
          },
        ],
      },
    });
    mockPrisma.importJob.updateMany.mockResolvedValueOnce({ count: 1 });

    await executorService.executeImport('job-stock', 'user-1');

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    expect(mockPrisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: StockMovementType.OPENING_BALANCE,
          quantity: 50,
          referenceType: 'IMPORT_JOB',
          referenceId: 'job-stock',
        }),
      }),
    );
  });

  it('should execute customer opening balances and update running balance', async () => {
    mockPrisma.importJob.findUnique.mockResolvedValueOnce({
      id: 'job-cust-bal',
      organizationId: 'org-1',
      type: ImportType.CUSTOMER_OPENING_BALANCES,
      status: ImportJobStatus.READY,
      totalRows: 1,
      originalFilename: 'cust_bal.csv',
      metadata: {
        parsedPayload: [
          {
            customerId: 'c-1',
            branchId: 'br-1',
            amount: 5000,
          },
        ],
      },
    });
    mockPrisma.importJob.updateMany.mockResolvedValueOnce({ count: 1 });

    await executorService.executeImport('job-cust-bal', 'user-1');

    expect(mockPrisma.customerLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: CustomerLedgerEntryType.OPENING_BALANCE,
          debit: expect.anything(),
          runningBalance: expect.anything(),
        }),
      }),
    );
    expect(mockPrisma.customer.update).toHaveBeenCalled();
  });

  it('should reject execution if job is not in READY status', async () => {
    mockPrisma.importJob.findUnique.mockResolvedValueOnce({
      id: 'job-fail',
      status: ImportJobStatus.COMPLETED,
    });

    await expect(executorService.executeImport('job-fail')).rejects.toThrowError(
      /Only jobs in "READY" status/i,
    );
  });

  it('should rollback transaction and set job status to FAILED on error', async () => {
    mockPrisma.importJob.findUnique.mockResolvedValueOnce({
      id: 'job-err',
      organizationId: 'org-1',
      type: ImportType.PRODUCTS,
      status: ImportJobStatus.READY,
      totalRows: 1,
      originalFilename: 'products.csv',
      metadata: {
        parsedPayload: [
          { sku: 'MED-001', name: 'Panadol', genericName: 'Paracetamol' },
        ],
      },
    });
    mockPrisma.importJob.updateMany.mockResolvedValueOnce({ count: 1 });
    mockPrisma.product.create.mockRejectedValueOnce(new Error('Unique constraint failed on SKU'));

    await expect(executorService.executeImport('job-err')).rejects.toThrowError(
      /Unique constraint failed/i,
    );

    expect(mockPrisma.importJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-err' },
        data: expect.objectContaining({
          status: ImportJobStatus.FAILED,
        }),
      }),
    );
  });
});
