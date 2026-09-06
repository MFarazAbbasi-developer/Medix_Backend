import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { SettingsService } from '../settings/settings.service';
import { FefoService } from './fefo.service';
import { BadRequestException } from '@nestjs/common';
import { StockMovementType, StockAdjustmentStatus, StockAdjustmentReason } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

describe('InventoryService', () => {
  let service: InventoryService;
  let prisma: PrismaService;
  let auditService: AuditService;
  let numberingService: NumberingService;
  let settingsService: SettingsService;
  let fefoService: FefoService;

  const mockOrg = { id: 'org-1', name: 'Medix Pharma' };
  const mockWarehouse = {
    id: 'wh-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    name: 'Main Storage',
    code: 'WH-MAIN',
    isActive: true,
    branch: { id: 'branch-1', isActive: true },
  };
  const mockProduct = {
    id: 'prod-1',
    organizationId: 'org-1',
    name: 'Panadol Extra',
    sku: 'PAN-500',
    isActive: true,
  };
  const mockBatch = {
    id: 'batch-1',
    productId: 'prod-1',
    batchNumber: 'B-001',
    expiryDate: new Date('2028-01-01'),
    status: 'ACTIVE',
    purchaseCost: new Decimal('100.00'),
    tradePrice: new Decimal('120.00'),
    retailPrice: new Decimal('140.00'),
  };

  beforeEach(() => {
    prisma = {
      organization: { findFirst: vi.fn() },
      warehouse: { findFirst: vi.fn(), findUnique: vi.fn() },
      product: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      batch: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
      stockMovement: { create: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      stockAdjustment: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn(), count: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'batch-1' }]),
    } as unknown as PrismaService;

    auditService = { log: vi.fn() } as unknown as AuditService;
    numberingService = { generateNextNumber: vi.fn() } as unknown as NumberingService;
    settingsService = { getSetting: vi.fn() } as unknown as SettingsService;
    fefoService = { allocate: vi.fn() } as unknown as FefoService;

    service = new InventoryService(
      prisma,
      auditService,
      numberingService,
      settingsService,
      fefoService,
    );
  });

  describe('validateMovementSign Invariant', () => {
    it('should reject zero quantity', () => {
      expect(() =>
        service.validateMovementSign(StockMovementType.STOCK_ADJUSTMENT_IN, 0),
      ).toThrow(BadRequestException);
    });

    it('should reject negative quantity for inbound movement types', () => {
      expect(() =>
        service.validateMovementSign(StockMovementType.OPENING_BALANCE, -10),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validateMovementSign(StockMovementType.STOCK_ADJUSTMENT_IN, -5),
      ).toThrow(BadRequestException);
    });

    it('should reject positive quantity for outbound movement types', () => {
      expect(() =>
        service.validateMovementSign(StockMovementType.STOCK_ADJUSTMENT_OUT, 10),
      ).toThrow(BadRequestException);
    });

    it('should accept valid signed combinations', () => {
      expect(() =>
        service.validateMovementSign(StockMovementType.OPENING_BALANCE, 25),
      ).not.toThrow();

      expect(() =>
        service.validateMovementSign(StockMovementType.STOCK_ADJUSTMENT_IN, 15),
      ).not.toThrow();

      expect(() =>
        service.validateMovementSign(StockMovementType.STOCK_ADJUSTMENT_OUT, -8),
      ).not.toThrow();
    });
  });

  describe('createOpeningBalance', () => {
    it('should create an opening balance with batch lock and positive movement', async () => {
      vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
      vi.spyOn(prisma.warehouse, 'findFirst').mockResolvedValue(mockWarehouse as any);
      vi.spyOn(prisma.product, 'findFirst').mockResolvedValue(mockProduct as any);
      vi.spyOn(prisma.batch, 'findFirst').mockResolvedValue(mockBatch as any);
      vi.spyOn(prisma.stockMovement, 'create').mockResolvedValue({
        id: 'move-1',
        quantity: 50,
      } as any);

      const result = await service.createOpeningBalance({
        warehouseId: 'wh-1',
        productId: 'prod-1',
        batchId: 'batch-1',
        quantity: 50,
      });

      expect(result).toBeDefined();
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: StockMovementType.OPENING_BALANCE,
            quantity: 50,
            referenceType: 'OPENING_BALANCE',
          }),
        }),
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_OPENING_BALANCE' }),
      );
    });
  });

  describe('postStockAdjustment', () => {
    it('should post adjustment with atomic document numbering and signed movements', async () => {
      vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
      vi.spyOn(settingsService, 'getSetting').mockResolvedValue('false');

      const mockAdjustment = {
        id: 'adj-1',
        branchId: 'branch-1',
        warehouseId: 'wh-1',
        status: StockAdjustmentStatus.DRAFT,
        reason: StockAdjustmentReason.PHYSICAL_INVENTORY_VARIANCE,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            quantity: 10, // positive variance (+10)
            unitCost: new Decimal('100.00'),
            remarks: 'Found extra pack',
            batch: mockBatch,
            product: mockProduct,
          },
          {
            id: 'item-2',
            productId: 'prod-1',
            batchId: 'batch-1',
            quantity: -5, // negative variance (-5)
            unitCost: new Decimal('100.00'),
            remarks: 'Damaged ampoule',
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      vi.spyOn(prisma.stockAdjustment, 'findUnique').mockResolvedValue(mockAdjustment as any);
      vi.spyOn(prisma.stockMovement, 'aggregate').mockResolvedValue({ _sum: { quantity: 20 } } as any);
      vi.spyOn(numberingService, 'generateNextNumber').mockResolvedValue({
        documentNumber: 'ADJ-00001',
        seriesId: 'series-1',
        sequence: 1,
      });
      vi.spyOn(prisma.stockAdjustment, 'update').mockResolvedValue({
        ...mockAdjustment,
        adjustmentNumber: 'ADJ-00001',
        status: StockAdjustmentStatus.POSTED,
      } as any);

      const result = await service.postStockAdjustment('adj-1', 'user-1');

      expect(result.status).toBe(StockAdjustmentStatus.POSTED);
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith('STOCK_ADJUSTMENT', 'branch-1');
      expect(prisma.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'POST_STOCK_ADJUSTMENT' }),
      );
    });

    it('should reject posting if negative stock occurs and allowNegativeStock is false', async () => {
      vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
      vi.spyOn(settingsService, 'getSetting').mockResolvedValue('false');

      const mockAdjustment = {
        id: 'adj-1',
        branchId: 'branch-1',
        warehouseId: 'wh-1',
        status: StockAdjustmentStatus.DRAFT,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            quantity: -30, // Current balance is only 10
            unitCost: new Decimal('100.00'),
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      vi.spyOn(prisma.stockAdjustment, 'findUnique').mockResolvedValue(mockAdjustment as any);
      vi.spyOn(prisma.stockMovement, 'aggregate').mockResolvedValue({ _sum: { quantity: 10 } } as any);
      vi.spyOn(numberingService, 'generateNextNumber').mockResolvedValue({
        documentNumber: 'ADJ-00002',
        seriesId: 'series-1',
        sequence: 2,
      });

      await expect(service.postStockAdjustment('adj-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('reverseStockAdjustment', () => {
    it('should create compensating reversal adjustment and inverse movements', async () => {
      vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
      vi.spyOn(settingsService, 'getSetting').mockResolvedValue('false');

      const mockPostedAdjustment = {
        id: 'adj-orig',
        adjustmentNumber: 'ADJ-00010',
        branchId: 'branch-1',
        warehouseId: 'wh-1',
        status: StockAdjustmentStatus.POSTED,
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            quantity: 15, // original was +15
            unitCost: new Decimal('100.00'),
            batch: mockBatch,
            product: mockProduct,
          },
        ],
      };

      vi.spyOn(prisma.stockAdjustment, 'findUnique').mockResolvedValue(mockPostedAdjustment as any);
      vi.spyOn(prisma.stockMovement, 'aggregate').mockResolvedValue({ _sum: { quantity: 20 } } as any);
      vi.spyOn(numberingService, 'generateNextNumber').mockResolvedValue({
        documentNumber: 'ADJ-00011',
        seriesId: 'series-1',
        sequence: 11,
      });
      vi.spyOn(prisma.stockAdjustment, 'create').mockResolvedValue({ id: 'adj-rev', adjustmentNumber: 'ADJ-00011' } as any);

      const result = await service.reverseStockAdjustment('adj-orig', 'user-1');

      expect(result).toBeDefined();
      expect(prisma.stockAdjustment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            adjustmentNumber: 'ADJ-00011',
            reason: 'CORRECTION',
            status: StockAdjustmentStatus.POSTED,
          }),
        }),
      );

      // Compensating movement must be -15 with referenceType ADJUSTMENT_REVERSAL
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: StockMovementType.STOCK_ADJUSTMENT_OUT,
            quantity: -15,
            referenceType: 'ADJUSTMENT_REVERSAL',
          }),
        }),
      );

      expect(prisma.stockAdjustment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adj-orig' },
          data: expect.objectContaining({ status: StockAdjustmentStatus.CANCELLED }),
        }),
      );
    });
  });
});
