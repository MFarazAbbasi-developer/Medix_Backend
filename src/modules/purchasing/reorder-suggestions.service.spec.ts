import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReorderSuggestionsService } from './reorder-suggestions.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SuggestionHealthStatus } from './dto/reorder-suggestions.dto';
import { PurchaseOrderStatus, SalesInvoiceStatus, SalesReturnStatus, GrnStatus } from '@prisma/client';

describe('ReorderSuggestionsService', () => {
  let service: ReorderSuggestionsService;
  let mockPrisma: any;
  let mockAudit: any;
  let mockNumbering: any;

  const mockOrg = { id: 'org-uuid-1', name: 'Medix Pharma' };
  const mockBranch = { id: 'branch-uuid-1', organizationId: 'org-uuid-1', name: 'Main Branch', isActive: true };

  beforeEach(() => {
    mockPrisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue(mockBranch),
      },
      systemSetting: {
        findMany: vi.fn().mockResolvedValue([
          { key: 'REORDER_DEFAULT_LOOKBACK_DAYS', value: '30' },
          { key: 'REORDER_DEFAULT_LEAD_TIME_DAYS', value: '7' },
          { key: 'REORDER_DEFAULT_SAFETY_STOCK_DAYS', value: '7' },
          { key: 'REORDER_DEFAULT_TARGET_STOCK_DAYS', value: '30' },
          { key: 'REORDER_SHORT_EXPIRY_THRESHOLD_DAYS', value: '90' },
        ]),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      purchaseOrderItem: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      salesInvoiceItem: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      salesReturnItem: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      goodsReceiveNoteItem: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      supplier: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      productReplenishmentConfig: {
        upsert: vi.fn(),
      },
      purchaseOrder: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback(mockPrisma);
      }),
    };

    mockAudit = {
      log: vi.fn().mockResolvedValue(true),
    };

    mockNumbering = {
      generateNextNumber: vi.fn().mockResolvedValue({ documentNumber: 'PO-00001' }),
    };

    service = new ReorderSuggestionsService(mockPrisma, mockAudit, mockNumbering);
  });

  describe('Date semantics & Expiry consistency', () => {
    it('should exclude expired batches and separate short-expiry stock according to ExpiryService semantics', async () => {
      const now = new Date();
      const expiredDate = new Date(now.getTime() - 5 * 86400000); // 5 days ago
      const shortExpiryDate = new Date(now.getTime() + 45 * 86400000); // 45 days ahead (< 90d)
      const validDate = new Date(now.getTime() + 365 * 86400000); // 1 year ahead

      const mockProduct = {
        id: 'prod-1',
        sku: 'MED-001',
        name: 'Panadol 500mg',
        genericName: 'Paracetamol',
        dosageForm: 'Tablet',
        strength: '500mg',
        packSize: '10x10',
        isActive: true,
        createdAt: new Date(now.getTime() - 100 * 86400000),
        category: { id: 'cat-1', name: 'Analgesics' },
        manufacturer: { id: 'mfg-1', name: 'GSK', code: 'GSK' },
        unit: { id: 'u-1', name: 'Box', symbol: 'Box' },
        replenishmentConfigs: [],
        batches: [
          {
            id: 'batch-exp',
            batchNumber: 'B-EXP',
            expiryDate: expiredDate,
            purchaseCost: 50,
            status: 'ACTIVE',
            stockMovements: [{ quantity: 30, warehouse: { warehouseType: 'STANDARD' } }],
          },
          {
            id: 'batch-short',
            batchNumber: 'B-SHORT',
            expiryDate: shortExpiryDate,
            purchaseCost: 50,
            status: 'ACTIVE',
            stockMovements: [{ quantity: 50, warehouse: { warehouseType: 'STANDARD' } }],
          },
          {
            id: 'batch-valid',
            batchNumber: 'B-VALID',
            expiryDate: validDate,
            purchaseCost: 50,
            status: 'ACTIVE',
            stockMovements: [{ quantity: 100, warehouse: { warehouseType: 'STANDARD' } }],
          },
        ],
      };

      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);

      // 1. Default (excludeShortExpiry = false): All non-expired active standard stock is saleable
      const resDefault = await service.getSuggestions({ branchId: 'branch-uuid-1' });
      const itemDefault = resDefault.items[0];

      expect(itemDefault.expiredStock).toBe(30);
      expect(itemDefault.shortExpiryStock).toBe(50);
      expect(itemDefault.saleableStock).toBe(150); // 50 (short) + 100 (valid)

      // 2. Toggle on (excludeShortExpiry = true): Short-expiry stock excluded from saleable
      const resFiltered = await service.getSuggestions({ branchId: 'branch-uuid-1', excludeShortExpiry: true });
      const itemFiltered = resFiltered.items[0];

      expect(itemFiltered.expiredStock).toBe(30);
      expect(itemFiltered.shortExpiryStock).toBe(50);
      expect(itemFiltered.saleableStock).toBe(100); // strictly valid long-dated stock
    });
  });

  describe('Zero-sales & Configured ROP Behavior', () => {
    it('should NOT generate reorder suggestion when ADS=0 and no configured ROP exists', async () => {
      const now = new Date();
      const mockProduct = {
        id: 'prod-zero',
        sku: 'MED-ZERO',
        name: 'Slow Mover',
        genericName: 'Inactive Chemical',
        isActive: true,
        createdAt: new Date(now.getTime() - 100 * 86400000),
        replenishmentConfigs: [],
        batches: [],
      };

      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);

      const res = await service.getSuggestions({ branchId: 'branch-uuid-1' });
      const item = res.items[0];

      expect(item.averageDailySales).toBe(0);
      expect(item.reorderPoint).toBe(0);
      expect(item.healthStatus).toBe(SuggestionHealthStatus.HEALTHY);
      expect(item.suggestedQuantity).toBe(0);
    });

    it('should generate reorder suggestion when ADS=0 but positive ROP is explicitly configured', async () => {
      const now = new Date();
      const mockProduct = {
        id: 'prod-cfg',
        sku: 'MED-CFG',
        name: 'Emergency Antidote',
        genericName: 'Atropine',
        isActive: true,
        createdAt: new Date(now.getTime() - 100 * 86400000),
        replenishmentConfigs: [
          {
            id: 'cfg-1',
            reorderPoint: 20,
            targetStock: 50,
            minOrderQuantity: 10,
            reorderQuantity: 5,
            leadTimeDays: 5,
            preferredSupplier: null,
          },
        ],
        batches: [
          {
            id: 'b-1',
            expiryDate: new Date(now.getTime() + 200 * 86400000),
            purchaseCost: 100,
            status: 'ACTIVE',
            stockMovements: [{ quantity: 5, warehouse: { warehouseType: 'STANDARD' } }],
          },
        ],
      };

      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);

      const res = await service.getSuggestions({ branchId: 'branch-uuid-1' });
      const item = res.items[0];

      expect(item.averageDailySales).toBe(0);
      expect(item.reorderPoint).toBe(20);
      expect(item.reorderPointSource).toBe('CONFIGURED');
      expect(item.healthStatus).toBe(SuggestionHealthStatus.REORDER_NEEDED); // Net 5 <= ROP 20
      // Deficit: Target 50 - Net 5 = 45 (rounded to multiple of 5)
      expect(item.suggestedQuantity).toBe(45);
    });
  });

  describe('Open PO Pipeline Scoping', () => {
    it('should strictly scope open PO pipeline to current branch and exclude other branches', async () => {
      const now = new Date();
      const mockProduct = {
        id: 'prod-po',
        sku: 'MED-PO',
        name: 'Amoxicillin 500mg',
        genericName: 'Amoxicillin',
        isActive: true,
        createdAt: new Date(now.getTime() - 100 * 86400000),
        replenishmentConfigs: [],
        batches: [
          {
            id: 'b-po',
            expiryDate: new Date(now.getTime() + 200 * 86400000),
            purchaseCost: 80,
            status: 'ACTIVE',
            stockMovements: [{ quantity: 50, warehouse: { warehouseType: 'STANDARD' } }],
          },
        ],
      };

      mockPrisma.product.findMany.mockResolvedValue([mockProduct]);

      // Mock open PO query
      mockPrisma.purchaseOrderItem.findMany.mockImplementation((args: any) => {
        expect(args.where.purchaseOrder.branchId).toBe('branch-uuid-1');
        return [
          { productId: 'prod-po', orderedQuantity: 100, receivedQuantity: 40 }, // Open 60
        ];
      });

      const res = await service.getSuggestions({ branchId: 'branch-uuid-1' });
      const item = res.items[0];

      expect(item.saleableStock).toBe(50);
      expect(item.openPoQuantity).toBe(60);
      expect(item.netPosition).toBe(110); // 50 + 60
    });
  });

  describe('Replenishment Config Validation', () => {
    it('should reject targetStock < reorderPoint with BadRequestException', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-val', organizationId: 'org-uuid-1' });

      await expect(
        service.upsertReplenishmentConfig(
          'prod-val',
          { reorderPoint: 100, targetStock: 50 },
          'branch-uuid-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject negative reorderPoint or zero minOrderQuantity', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-val', organizationId: 'org-uuid-1' });

      await expect(
        service.upsertReplenishmentConfig(
          'prod-val',
          { reorderPoint: -5 },
          'branch-uuid-1',
        ),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.upsertReplenishmentConfig(
          'prod-val',
          { minOrderQuantity: 0 },
          'branch-uuid-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject supplier from a different organization', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({ id: 'prod-val', organizationId: 'org-uuid-1' });
      mockPrisma.supplier.findFirst.mockResolvedValue(null); // not found in org

      await expect(
        service.upsertReplenishmentConfig(
          'prod-val',
          { preferredSupplierId: 'invalid-sup' },
          'branch-uuid-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Create Draft PO Backend Revalidation', () => {
    it('should revalidate items, group by supplier, and create draft purchase orders', async () => {
      const mockSupA = { id: 'sup-a', name: 'Getz Pharma Distribution', code: 'SUP-GETZ', isActive: true };
      const mockSupB = { id: 'sup-b', name: 'GSK Distributors', code: 'SUP-GSK', isActive: true };

      mockPrisma.product.findFirst
        .mockResolvedValueOnce({
          id: 'prod-1',
          name: 'Panadol',
          sku: 'PAN',
          isActive: true,
          replenishmentConfigs: [{ preferredSupplierId: 'sup-a' }],
          batches: [{ purchaseCost: 40 }],
        })
        .mockResolvedValueOnce({
          id: 'prod-2',
          name: 'Augmentin',
          sku: 'AUG',
          isActive: true,
          replenishmentConfigs: [{ preferredSupplierId: 'sup-b' }],
          batches: [{ purchaseCost: 150 }],
        });

      mockPrisma.supplier.findFirst
        .mockResolvedValueOnce(mockSupA)
        .mockResolvedValueOnce(mockSupB);

      mockPrisma.purchaseOrder.create
        .mockResolvedValueOnce({ id: 'po-1', poNumber: 'PO-00001', supplier: mockSupA, items: [], netTotal: '2000' })
        .mockResolvedValueOnce({ id: 'po-2', poNumber: 'PO-00002', supplier: mockSupB, items: [], netTotal: '3000' });

      const res = await service.createDraftPurchaseOrders({
        branchId: 'branch-uuid-1',
        items: [
          { productId: 'prod-1', quantity: 50 },
          { productId: 'prod-2', quantity: 20 },
        ],
      });

      expect(res.orders.length).toBe(2);
      expect(mockNumbering.generateNextNumber).toHaveBeenCalledTimes(2);
    });

    it('should reject draft PO generation if a product has no supplier resolved', async () => {
      mockPrisma.product.findFirst.mockResolvedValue({
        id: 'prod-no-sup',
        name: 'Generic Paracetamol',
        sku: 'GEN-PAR',
        isActive: true,
        replenishmentConfigs: [],
        batches: [],
      });
      mockPrisma.goodsReceiveNoteItem.findFirst.mockResolvedValue(null);

      await expect(
        service.createDraftPurchaseOrders({
          branchId: 'branch-uuid-1',
          items: [{ productId: 'prod-no-sup', quantity: 30 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
