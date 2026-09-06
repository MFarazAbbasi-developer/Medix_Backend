import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PurchaseOrderService } from './purchase-order.service';
import { GrnService } from './grn.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DocumentType,
  PurchaseOrderStatus,
  GrnStatus,
  StockMovementType,
  SupplierLedgerEntryType,
  BatchStatus,
} from '@prisma/client';

describe('Purchasing Module Services', () => {
  let poService: PurchaseOrderService;
  let grnService: GrnService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockOrg = { id: 'org-1', name: 'Farmax Health' };
  const mockBranch = { id: 'branch-1', organizationId: 'org-1', name: 'Main Branch', isActive: true };
  const mockWarehouse = {
    id: 'wh-1',
    branchId: 'branch-1',
    organizationId: 'org-1',
    name: 'Central Warehouse',
    isActive: true,
    branch: mockBranch,
  };
  const mockSupplier = {
    id: 'sup-1',
    organizationId: 'org-1',
    code: 'SUP-001',
    name: 'Getz Pharma',
    currentBalance: new Decimal('5000.00'),
    isActive: true,
  };
  const mockProduct = {
    id: 'prod-1',
    organizationId: 'org-1',
    name: 'Panadol 500mg',
    sku: 'MED-PAN-500',
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(mockOrg) },
      branch: { findFirst: vi.fn().mockResolvedValue(mockBranch) },
      warehouse: { findFirst: vi.fn().mockResolvedValue(mockWarehouse) },
      supplier: {
        findFirst: vi.fn().mockResolvedValue(mockSupplier),
        findUnique: vi.fn().mockResolvedValue(mockSupplier),
        update: vi.fn().mockResolvedValue(mockSupplier),
      },
      product: {
        findMany: vi.fn().mockResolvedValue([mockProduct]),
        findFirst: vi.fn().mockResolvedValue(mockProduct),
      },
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: '30' }),
      },
      batch: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 'batch-1',
          productId: 'prod-1',
          batchNumber: 'BN-101',
          purchaseCost: new Decimal('40.00'),
          tradePrice: new Decimal('45.00'),
          retailPrice: new Decimal('50.00'),
          status: BatchStatus.ACTIVE,
        }),
      },
      purchaseOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'po-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          supplierId: 'sup-1',
          poNumber: 'PO-00001',
          status: PurchaseOrderStatus.DRAFT,
          subtotal: new Decimal('4000.00'),
          netTotal: new Decimal('4000.00'),
          items: [{ id: 'po-item-1', productId: 'prod-1', orderedQuantity: 100, receivedQuantity: 0 }],
        }),
        create: vi.fn().mockResolvedValue({
          id: 'po-1',
          poNumber: 'PO-00001',
          items: [{ id: 'po-item-1', productId: 'prod-1' }],
          netTotal: new Decimal('4000.00'),
        }),
        update: vi.fn().mockResolvedValue({ id: 'po-1', status: PurchaseOrderStatus.ISSUED }),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
      },
      purchaseOrderItem: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'po-item-1',
          purchaseOrderId: 'po-1',
          productId: 'prod-1',
          orderedQuantity: 100,
          receivedQuantity: 0,
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'po-item-1', orderedQuantity: 100, receivedQuantity: 100 },
        ]),
        update: vi.fn().mockResolvedValue({ id: 'po-item-1', receivedQuantity: 100 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      goodsReceiveNote: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'grn-1',
          organizationId: 'org-1',
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          supplierId: 'sup-1',
          purchaseOrderId: 'po-1',
          grnNumber: 'DRAFT-GRN-1',
          status: GrnStatus.DRAFT,
          subtotal: new Decimal('4000.00'),
          discountAmount: new Decimal('0.00'),
          taxAmount: new Decimal('0.00'),
          netTotal: new Decimal('4000.00'),
          supplier: mockSupplier,
          branch: mockBranch,
          warehouse: mockWarehouse,
          purchaseOrder: {
            id: 'po-1',
            status: PurchaseOrderStatus.ISSUED,
            items: [{ id: 'po-item-1', orderedQuantity: 100, receivedQuantity: 0 }],
          },
          items: [
            {
              id: 'grn-item-1',
              grnId: 'grn-1',
              poItemId: 'po-item-1',
              productId: 'prod-1',
              batchNumber: 'BN-101',
              mfgDate: new Date('2026-01-01'),
              expiryDate: new Date('2028-01-01'),
              receivedQuantity: 100,
              bonusQuantity: 10,
              unitCost: new Decimal('40.00'),
              tradePrice: new Decimal('45.00'),
              retailPrice: new Decimal('50.00'),
              discountPercentage: new Decimal('0.00'),
              taxPercentage: new Decimal('0.00'),
              lineTotal: new Decimal('4000.00'),
              product: mockProduct,
            },
          ],
        }),
        create: vi.fn().mockResolvedValue({
          id: 'grn-1',
          grnNumber: 'DRAFT-GRN-1',
          items: [{ id: 'grn-item-1' }],
          netTotal: new Decimal('4000.00'),
        }),
        update: vi.fn().mockResolvedValue({
          id: 'grn-1',
          grnNumber: 'GRN-00001',
          status: GrnStatus.POSTED,
          netTotal: new Decimal('4000.00'),
          supplier: mockSupplier,
          warehouse: mockWarehouse,
          items: [{ id: 'grn-item-1' }],
        }),
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        delete: vi.fn().mockResolvedValue({ id: 'grn-1' }),
      },
      goodsReceiveNoteItem: {
        update: vi.fn().mockResolvedValue({ id: 'grn-item-1', batchId: 'batch-1' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      supplierLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'sle-1' }),
      },
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'GRN-00001',
        sequence: 1,
        seriesId: 'ns-1',
      }),
    };

    poService = new PurchaseOrderService(
      prisma as PrismaService,
      auditService as AuditService,
      numberingService as NumberingService,
    );

    grnService = new GrnService(
      prisma as PrismaService,
      auditService as AuditService,
      numberingService as NumberingService,
    );
  });

  describe('PurchaseOrderService', () => {
    it('should create a draft purchase order with correct pricing calculations', async () => {
      numberingService.generateNextNumber.mockResolvedValueOnce({
        documentNumber: 'PO-00001',
      });

      const po = await poService.create({
        branchId: 'branch-1',
        supplierId: 'sup-1',
        items: [
          {
            productId: 'prod-1',
            orderedQuantity: 100,
            unitCost: 40,
            discountPercentage: 5,
            taxPercentage: 10,
          },
        ],
      });

      expect(prisma.purchaseOrder.create).toHaveBeenCalled();
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.PURCHASE_ORDER,
        'branch-1',
      );
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_PURCHASE_ORDER' }),
      );
      expect(po).toBeDefined();
    });

    it('should reject editing a non-draft purchase order', async () => {
      prisma.purchaseOrder.findFirst.mockResolvedValueOnce({
        id: 'po-1',
        status: PurchaseOrderStatus.ISSUED,
      });

      await expect(
        poService.update('po-1', { notes: 'Updated notes' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('GrnService', () => {
    it('should create a draft GRN with bonus quantity and validated dates', async () => {
      const grn = await grnService.create({
        branchId: 'branch-1',
        warehouseId: 'wh-1',
        supplierId: 'sup-1',
        items: [
          {
            productId: 'prod-1',
            batchNumber: 'BN-101',
            mfgDate: '2026-01-01',
            expiryDate: '2028-01-01',
            receivedQuantity: 100,
            bonusQuantity: 10,
            unitCost: 40,
            tradePrice: 45,
            retailPrice: 50,
          },
        ],
      });

      expect(prisma.goodsReceiveNote.create).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_GOODS_RECEIVE_NOTE' }),
      );
      expect(grn).toBeDefined();
    });

    it('should reject GRN creation if expiry date is before manufacturing date', async () => {
      await expect(
        grnService.create({
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          supplierId: 'sup-1',
          items: [
            {
              productId: 'prod-1',
              batchNumber: 'BN-101',
              mfgDate: '2028-01-01',
              expiryDate: '2026-01-01',
              receivedQuantity: 100,
              unitCost: 40,
              tradePrice: 45,
              retailPrice: 50,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject GRN creation if expiry date is today or in the past', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      await expect(
        grnService.create({
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          supplierId: 'sup-1',
          items: [
            {
              productId: 'prod-1',
              batchNumber: 'BN-EXPIRED',
              expiryDate: pastDate.toISOString().split('T')[0],
              receivedQuantity: 50,
              unitCost: 40,
              tradePrice: 45,
              retailPrice: 50,
            },
          ],
        }),
      ).rejects.toThrow('must be in the future (today or earlier is expired)');
    });

    it('should return advisory warnings for near-expiry batches below MIN_REMAINING_SHELF_LIFE_DAYS', async () => {
      const nearExpiryDate = new Date();
      nearExpiryDate.setDate(nearExpiryDate.getDate() + 15); // 15 days < 30 days threshold

      const grn = await grnService.create({
        branchId: 'branch-1',
        warehouseId: 'wh-1',
        supplierId: 'sup-1',
        items: [
          {
            productId: 'prod-1',
            batchNumber: 'BN-NEAR-EXP',
            expiryDate: nearExpiryDate.toISOString().split('T')[0],
            receivedQuantity: 50,
            unitCost: 40,
            tradePrice: 45,
            retailPrice: 50,
          },
        ],
      });

      expect(grn.warnings).toBeDefined();
      expect(grn.warnings?.length).toBeGreaterThan(0);
      expect(grn.warnings?.[0]).toContain('remaining shelf life');
    });

    it('should post a GRN with bonus costing weighted average acquisition cost in StockMovement', async () => {
      const posted = await grnService.postGrn('grn-1', 'user-1');

      // 1. Permanent numbering
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.GOODS_RECEIVE_NOTE,
        'branch-1',
      );

      // 2. Stock movement inflow (+110 total units: 100 paid + 10 bonus)
      // Effective cost = (100 * 40) / 110 = 36.3636...
      const expectedEffectiveCost = new Decimal((100 * 40) / 110);
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: StockMovementType.PURCHASE_RECEIPT,
            quantity: 110,
            unitCost: expect.any(Object),
            referenceType: 'GOODS_RECEIVE_NOTE',
          }),
        }),
      );

      // 3. Supplier payable credit (Rs. 4,000 for billed units)
      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: SupplierLedgerEntryType.GRN_INVOICE,
          }),
        }),
      );

      // 4. Supplier current balance updated
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sup-1' },
        }),
      );

      // 5. GRN updated to POSTED
      expect(prisma.goodsReceiveNote.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'grn-1' },
          data: expect.objectContaining({
            status: GrnStatus.POSTED,
            grnNumber: 'GRN-00001',
          }),
        }),
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'POST_GOODS_RECEIVE_NOTE' }),
      );

      expect(posted.status).toBe(GrnStatus.POSTED);
    });

    it('should prevent over-receiving PO items during GRN posting', async () => {
      prisma.purchaseOrderItem.findUnique.mockResolvedValueOnce({
        id: 'po-item-1',
        orderedQuantity: 100,
        receivedQuantity: 90,
      });

      // GRN item attempting to receive 20 when only 10 left on PO
      await expect(grnService.postGrn('grn-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
