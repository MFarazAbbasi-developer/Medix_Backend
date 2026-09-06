import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ExpiryService } from './expiry.service';
import { BadRequestException } from '@nestjs/common';
import { BatchStatus, RecallStatus, RecallSeverity, WarehouseType } from '@prisma/client';

describe('ExpiryService', () => {
  let service: ExpiryService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockOrg = { id: 'org-1', name: 'Medix Pharma' };
  const mockUser = { id: 'user-1', username: 'admin' };

  const mockStandardWh = {
    id: 'wh-std-1',
    name: 'Main Dispensary',
    code: 'WH-MAIN',
    warehouseType: WarehouseType.STANDARD,
    branchId: 'branch-1',
  };

  const mockQuarantineWh = {
    id: 'wh-quar-1',
    name: 'Quarantine Section',
    code: 'WH-QUAR',
    warehouseType: WarehouseType.QUARANTINE,
    branchId: 'branch-1',
  };

  const mockProduct = {
    id: 'prod-1',
    name: 'Augmentin 625mg',
    sku: 'AUG-625',
    genericName: 'Amoxicillin + Clavulanic Acid',
    organizationId: 'org-1',
  };

  const now = new Date();
  const futureDate = new Date(now.getTime() + 45 * 24 * 60 * 60 * 1000); // 45 days ahead
  const expiredDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago

  const mockActiveBatch = {
    id: 'batch-1',
    productId: 'prod-1',
    batchNumber: 'BN-2026-01',
    mfgDate: new Date('2025-01-01'),
    expiryDate: futureDate,
    purchaseCost: '150.00',
    tradePrice: '180.00',
    retailPrice: '200.00',
    status: BatchStatus.ACTIVE,
    product: mockProduct,
  };

  const mockExpiredBatch = {
    id: 'batch-2',
    productId: 'prod-1',
    batchNumber: 'BN-2024-99',
    mfgDate: new Date('2024-01-01'),
    expiryDate: expiredDate,
    purchaseCost: '140.00',
    tradePrice: '170.00',
    retailPrice: '190.00',
    status: BatchStatus.ACTIVE,
    product: mockProduct,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      warehouse: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      product: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      batch: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
      stockMovement: {
        findMany: vi.fn(),
        create: vi.fn(),
      },
      productRecall: {
        create: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        update: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([]),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({ documentNumber: 'RCL-00001' }),
    };

    service = new ExpiryService(prisma, auditService, numberingService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('1. Expiry Management & Metrics', () => {
    it('should compute metrics for expired batches and threshold buckets dynamically', async () => {
      prisma.batch.findMany.mockResolvedValue([
        {
          ...mockExpiredBatch,
          stockMovements: [
            { quantity: 50, warehouse: { warehouseType: 'STANDARD' } },
          ],
        },
        {
          ...mockActiveBatch,
          stockMovements: [
            { quantity: 100, warehouse: { warehouseType: 'STANDARD' } },
            { quantity: 20, warehouse: { warehouseType: 'QUARANTINE' } },
          ],
        },
      ]);

      const metrics = await service.getExpiryMetrics({ thresholds: '30,60,90,180' });

      expect(metrics.expired.batchCount).toBe(1);
      expect(metrics.expired.totalQuantity).toBe(50);
      expect(metrics.expired.totalValuation).toBe(7000); // 50 * 140

      // 45 days is in 60d, 90d, 180d buckets
      const bucket30 = metrics.thresholds.find((t) => t.thresholdDays === 30);
      const bucket60 = metrics.thresholds.find((t) => t.thresholdDays === 60);
      expect(bucket30?.batchCount).toBe(0);
      expect(bucket60?.batchCount).toBe(1);
      expect(bucket60?.totalQuantity).toBe(120);

      // Warehouse stock aggregation
      expect(metrics.warehouseBreakdown.standard.quantity).toBe(150);
      expect(metrics.warehouseBreakdown.quarantine.quantity).toBe(20);
    });

    it('should get expiring batches with pagination and physical stock balances', async () => {
      prisma.batch.findMany.mockResolvedValue([
        {
          ...mockActiveBatch,
          stockMovements: [
            {
              warehouseId: 'wh-std-1',
              quantity: 80,
              warehouse: { name: 'Main', code: 'WH-MAIN', warehouseType: 'STANDARD' },
            },
          ],
        },
      ]);

      const result = await service.getExpiringBatches({ thresholdDays: 60 });

      expect(result.data.length).toBe(1);
      expect(result.data[0].batchNumber).toBe('BN-2026-01');
      expect(result.data[0].totalQuantity).toBe(80);
      expect(result.data[0].isExpired).toBe(false);
      expect(result.data[0].daysToExpiry).toBeGreaterThan(0);
    });
  });

  describe('2. Quarantine Operations', () => {
    it('should move physical stock from STANDARD to QUARANTINE atomically', async () => {
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(mockStandardWh)
        .mockResolvedValueOnce(mockQuarantineWh);

      prisma.batch.findFirst.mockResolvedValue(mockActiveBatch);
      prisma.stockMovement.findMany.mockResolvedValue([{ quantity: 100 }]); // 100 available

      const res = await service.moveStockToQuarantine(
        {
          sourceWarehouseId: 'wh-std-1',
          destinationWarehouseId: 'wh-quar-1',
          batchId: 'batch-1',
          quantity: 25,
          reason: 'Suspected box damage',
        },
        mockUser.id,
      );

      expect(res.success).toBe(true);
      // Verify 2 StockMovement records created (negative out, positive in)
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warehouseId: 'wh-std-1',
            quantity: -25,
            movementType: 'TRANSFER_OUT',
            referenceType: 'QUARANTINE_MOVE',
          }),
        }),
      );
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warehouseId: 'wh-quar-1',
            quantity: 25,
            movementType: 'TRANSFER_IN',
            referenceType: 'QUARANTINE_MOVE',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'QUARANTINE_STOCK_MOVE' }),
      );
    });

    it('should reject quarantine move if available stock is insufficient', async () => {
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(mockStandardWh)
        .mockResolvedValueOnce(mockQuarantineWh);

      prisma.batch.findFirst.mockResolvedValue(mockActiveBatch);
      prisma.stockMovement.findMany.mockResolvedValue([{ quantity: 10 }]); // only 10 available

      await expect(
        service.moveStockToQuarantine(
          {
            sourceWarehouseId: 'wh-std-1',
            destinationWarehouseId: 'wh-quar-1',
            batchId: 'batch-1',
            quantity: 50, // request 50
            reason: 'Test',
          },
          mockUser.id,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject quarantine release if batch is expired', async () => {
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(mockQuarantineWh)
        .mockResolvedValueOnce(mockStandardWh);

      prisma.batch.findFirst.mockResolvedValue(mockExpiredBatch);

      await expect(
        service.releaseQuarantineStock(
          {
            sourceWarehouseId: 'wh-quar-1',
            destinationWarehouseId: 'wh-std-1',
            batchId: 'batch-2',
            quantity: 10,
            reason: 'Passed inspection',
          },
          mockUser.id,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject quarantine release if batch is RECALLED', async () => {
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(mockQuarantineWh)
        .mockResolvedValueOnce(mockStandardWh);

      prisma.batch.findFirst.mockResolvedValue({
        ...mockActiveBatch,
        status: BatchStatus.RECALLED,
      });

      await expect(
        service.releaseQuarantineStock(
          {
            sourceWarehouseId: 'wh-quar-1',
            destinationWarehouseId: 'wh-std-1',
            batchId: 'batch-1',
            quantity: 10,
            reason: 'Try release recalled',
          },
          mockUser.id,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should successfully release valid non-expired active stock from QUARANTINE to STANDARD', async () => {
      prisma.warehouse.findFirst
        .mockResolvedValueOnce(mockQuarantineWh)
        .mockResolvedValueOnce(mockStandardWh);

      prisma.batch.findFirst.mockResolvedValue(mockActiveBatch);
      prisma.stockMovement.findMany.mockResolvedValue([{ quantity: 30 }]); // 30 in quarantine

      const res = await service.releaseQuarantineStock(
        {
          sourceWarehouseId: 'wh-quar-1',
          destinationWarehouseId: 'wh-std-1',
          batchId: 'batch-1',
          quantity: 15,
          reason: 'Passed QA inspection',
        },
        mockUser.id,
      );

      expect(res.success).toBe(true);
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'RELEASE_QUARANTINE_STOCK' }),
      );
    });
  });

  describe('3. Product Recall Management', () => {
    it('should create a batch-specific recall and update batch status to RECALLED', async () => {
      prisma.product.findFirst.mockResolvedValue(mockProduct);
      prisma.batch.findFirst.mockResolvedValue(mockActiveBatch);

      const createdRecallMock = {
        id: 'recall-1',
        recallNumber: 'RCL-00001',
        productId: 'prod-1',
        batchId: 'batch-1',
        reason: 'Packaging defect',
        severity: RecallSeverity.HIGH,
        status: RecallStatus.OPEN,
        recallDate: new Date(),
        product: mockProduct,
        batch: mockActiveBatch,
      };

      prisma.productRecall.create.mockResolvedValue(createdRecallMock);
      prisma.productRecall.findFirst.mockResolvedValue(createdRecallMock);
      prisma.stockMovement.findMany.mockResolvedValue([]);

      const result = await service.createRecall(
        {
          productId: 'prod-1',
          batchId: 'batch-1',
          reason: 'Packaging defect',
          severity: RecallSeverity.HIGH,
        },
        mockUser.id,
      );

      expect(numberingService.generateNextNumber).toHaveBeenCalledWith('PRODUCT_RECALL');
      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { status: BatchStatus.RECALLED },
      });
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_PRODUCT_RECALL' }),
      );
      expect(result.recallNumber).toBe('RCL-00001');
    });

    it('should restore batch status to ACTIVE upon resolving recall if no other open recall exists', async () => {
      const existingRecall = {
        id: 'recall-1',
        recallNumber: 'RCL-00001',
        batchId: 'batch-1',
        status: RecallStatus.OPEN,
        batch: { ...mockActiveBatch, status: BatchStatus.RECALLED },
        product: mockProduct,
      };

      prisma.productRecall.findFirst.mockResolvedValue(existingRecall);
      prisma.productRecall.findMany.mockResolvedValue([]); // No other open recalls
      prisma.stockMovement.findMany.mockResolvedValue([]);
      prisma.productRecall.update.mockResolvedValue({
        ...existingRecall,
        status: RecallStatus.RESOLVED,
      });

      await service.updateRecallStatus(
        'recall-1',
        { status: RecallStatus.RESOLVED, notes: 'Issue investigated and cleared' },
        mockUser.id,
      );

      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { status: BatchStatus.ACTIVE },
      });
    });

    it('should quarantine remaining stock in standard warehouses for recalled batch', async () => {
      const recallMock = {
        id: 'recall-1',
        recallNumber: 'RCL-00001',
        productId: 'prod-1',
        batchId: 'batch-1',
        reason: 'Recalled product',
        status: RecallStatus.OPEN,
        batch: mockActiveBatch,
        product: mockProduct,
      };

      prisma.productRecall.findFirst.mockResolvedValue(recallMock);
      prisma.warehouse.findFirst.mockResolvedValue(mockQuarantineWh);

      prisma.stockMovement.findMany.mockResolvedValue([
        {
          warehouseId: 'wh-std-1',
          quantity: 40,
          warehouse: mockStandardWh,
        },
      ]);

      const res = await service.quarantineRecalledStock('recall-1', 'wh-quar-1', mockUser.id);

      expect(res.success).toBe(true);
      expect(res.movedQuantity).toBe(40);
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'QUARANTINE_RECALLED_STOCK' }),
      );
    });
  });
});
