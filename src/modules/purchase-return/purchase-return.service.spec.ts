import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PurchaseReturnService } from './purchase-return.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DocumentType,
  PurchaseReturnStatus,
  GrnStatus,
  PurchaseReturnReason,
  ReturnedStockCondition,
  WarehouseType,
} from '@prisma/client';

describe('PurchaseReturnService', () => {
  let service: PurchaseReturnService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockSupplier = {
    id: 'sup-1',
    organizationId: 'org-1',
    name: 'Getz Pharma Distribution',
    current_balance: new Decimal('50000.00'),
    is_active: true,
  };

  const mockWarehouseStandard = {
    id: 'wh-std-1',
    organizationId: 'org-1',
    name: 'Main Pharma Warehouse',
    code: 'WH-MAIN',
    warehouseType: WarehouseType.STANDARD,
    isActive: true,
  };

  const mockWarehouseQuarantine = {
    id: 'wh-quar-1',
    organizationId: 'org-1',
    name: 'Quarantine Holding Zone',
    code: 'WH-QUAR',
    warehouseType: WarehouseType.QUARANTINE,
    isActive: true,
  };

  const mockGrnItem = {
    id: 'grn-item-1',
    grnId: 'grn-1',
    productId: 'prod-1',
    batchId: 'batch-1',
    batchNumber: 'BATCH-2026-A',
    expiryDate: new Date('2027-12-31'),
    receivedQuantity: 100,
    bonusQuantity: 10,
    unitCost: new Decimal('100.00'),
    discountPercentage: new Decimal('10.00'),
    taxPercentage: new Decimal('5.00'),
    tradePrice: new Decimal('110.00'),
    retailPrice: new Decimal('125.00'),
    product: {
      id: 'prod-1',
      name: 'Augmentin 625mg Tablets',
      sku: 'AUG-625',
      genericName: 'Co-Amoxiclav',
      packSize: '10s',
    },
    batch: {
      id: 'batch-1',
      batchNumber: 'BATCH-2026-A',
      expiryDate: new Date('2027-12-31'),
      status: 'ACTIVE',
    },
  };

  const mockGrn = {
    id: 'grn-1',
    organization_id: 'org-1',
    branch_id: 'branch-1',
    supplier_id: 'sup-1',
    grn_number: 'GRN-00001',
    status: GrnStatus.POSTED,
    net_total: new Decimal('9450.00'),
    paid_amount: new Decimal('0.00'),
    balance_amount: new Decimal('9450.00'),
    grnNumber: 'GRN-00001',
    supplierId: 'sup-1',
    warehouseId: 'wh-std-1',
    supplier: {
      id: 'sup-1',
      name: 'Getz Pharma Distribution',
      code: 'SUP-001',
    },
    warehouse: mockWarehouseStandard,
    branch: { id: 'branch-1', name: 'Main Branch', code: 'BR-01' },
    items: [mockGrnItem],
    purchaseReturns: [],
  };

  const mockPostedReturn = {
    id: 'pret-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    supplierId: 'sup-1',
    grnId: 'grn-1',
    returnNumber: 'PRET-00001',
    returnDate: new Date(),
    status: PurchaseReturnStatus.POSTED,
    reason: PurchaseReturnReason.DAMAGED_GOODS,
    subtotal: new Decimal('1000.00'),
    discountAmount: new Decimal('100.00'),
    taxAmount: new Decimal('45.00'),
    netTotal: new Decimal('945.00'),
    notes: 'Damaged packaging returned',
    items: [
      {
        id: 'pret-item-1',
        purchaseReturnId: 'pret-1',
        grnItemId: 'grn-item-1',
        productId: 'prod-1',
        batchId: 'batch-1',
        sourceWarehouseId: 'wh-std-1',
        returnedQuantity: 10,
        bonusReturnedQuantity: 0,
        totalReturnedQuantity: 10,
        stockCondition: ReturnedStockCondition.SALEABLE,
        unitCost: new Decimal('100.00'),
        discountPercentage: new Decimal('10.00'),
        discountAmount: new Decimal('100.00'),
        taxPercentage: new Decimal('5.00'),
        taxAmount: new Decimal('45.00'),
        lineTotal: new Decimal('945.00'),
        product: mockGrnItem.product,
        batch: mockGrnItem.batch,
        sourceWarehouse: mockWarehouseStandard,
      },
    ],
    grn: {
      id: 'grn-1',
      grnNumber: 'GRN-00001',
      netTotal: new Decimal('9450.00'),
    },
    supplier: {
      id: 'sup-1',
      name: 'Getz Pharma Distribution',
    },
    branch: {
      id: 'branch-1',
      name: 'Main Branch',
    },
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      warehouse: {
        findFirst: vi.fn().mockImplementation(({ where }: any) => {
          if (where.id === 'wh-std-1') return Promise.resolve(mockWarehouseStandard);
          if (where.id === 'wh-quar-1') return Promise.resolve(mockWarehouseQuarantine);
          return Promise.resolve(null);
        }),
      },
      supplier: {
        findFirst: vi.fn().mockResolvedValue(mockSupplier),
        update: vi.fn().mockResolvedValue(mockSupplier),
      },
      goodsReceiveNote: {
        findFirst: vi.fn().mockResolvedValue(mockGrn),
        update: vi.fn().mockResolvedValue(mockGrn),
      },
      goodsReceiveNoteItem: {
        findMany: vi.fn().mockResolvedValue([mockGrnItem]),
      },
      purchaseReturn: {
        create: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            id: 'pret-1',
            ...data,
          }),
        ),
        findFirst: vi.fn().mockResolvedValue(mockPostedReturn),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({
            ...mockPostedReturn,
            ...data,
          }),
        ),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { netTotal: new Decimal('945.00') },
        }),
      },
      purchaseReturnItem: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([{ quantity: 100 }]), // 100 units physically available
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      supplierPayment: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      supplierPaymentAllocation: {
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
      $transaction: vi.fn().mockImplementation((cb: any) => cb(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(true),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({ documentNumber: 'PRET-00001' }),
    };

    service = new PurchaseReturnService(prisma, auditService, numberingService);
  });

  describe('getReturnableGrn', () => {
    it('returns line items with remaining returnable quantities', async () => {
      const result = await service.getReturnableGrn('grn-1');
      expect(result).toBeDefined();
      expect(result.grn.grnNumber).toBe('GRN-00001');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].availableBilled).toBe(100);
      expect(result.items[0].availableBonus).toBe(10);
    });

    it('throws NotFoundException if GRN does not exist', async () => {
      prisma.goodsReceiveNote.findFirst.mockResolvedValueOnce(null);
      await expect(service.getReturnableGrn('unknown-grn')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createPurchaseReturn', () => {
    it('creates a posted purchase return, stock deduction, and supplier ledger debit note successfully', async () => {
      const result = await service.createPurchaseReturn({
        grnId: 'grn-1',
        reason: PurchaseReturnReason.DAMAGED_GOODS,
        items: [
          {
            grnItemId: 'grn-item-1',
            sourceWarehouseId: 'wh-std-1',
            returnedQuantity: 10,
            bonusReturnedQuantity: 0,
            stockCondition: ReturnedStockCondition.SALEABLE,
          },
        ],
        notes: 'Damaged blister packs returned',
      });

      expect(result).toBeDefined();
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.PURCHASE_RETURN,
        'branch-1',
      );
      // Verify physical stock deduction with negative quantity
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            warehouseId: 'wh-std-1',
            quantity: -10,
            movementType: 'PURCHASE_RETURN',
          }),
        }),
      );
      // Verify supplier ledger debit note
      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: 'sup-1',
            entryType: 'DEBIT_NOTE',
          }),
        }),
      );
      // Verify supplier balance updated
      expect(prisma.supplier.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sup-1' },
        }),
      );
      // Verify audit logged
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_PURCHASE_RETURN',
          entity: 'PURCHASE_RETURN',
        }),
      );
    });

    it('rejects return if returned quantity exceeds received quantity', async () => {
      await expect(
        service.createPurchaseReturn({
          grnId: 'grn-1',
          reason: PurchaseReturnReason.NEAR_EXPIRY_RECALL,
          items: [
            {
              grnItemId: 'grn-item-1',
              sourceWarehouseId: 'wh-std-1',
              returnedQuantity: 150, // exceeds received 100
              bonusReturnedQuantity: 0,
              stockCondition: ReturnedStockCondition.SALEABLE,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects return if warehouse has insufficient physical stock', async () => {
      prisma.stockMovement.findMany.mockResolvedValueOnce([{ quantity: 5 }]); // only 5 in stock

      await expect(
        service.createPurchaseReturn({
          grnId: 'grn-1',
          reason: PurchaseReturnReason.DEFECTIVE_BATCH,
          items: [
            {
              grnItemId: 'grn-item-1',
              sourceWarehouseId: 'wh-std-1',
              returnedQuantity: 10,
              bonusReturnedQuantity: 0,
              stockCondition: ReturnedStockCondition.SALEABLE,
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects SALEABLE return when sourced from QUARANTINE warehouse', async () => {
      await expect(
        service.createPurchaseReturn({
          grnId: 'grn-1',
          reason: PurchaseReturnReason.DAMAGED_GOODS,
          items: [
            {
              grnItemId: 'grn-item-1',
              sourceWarehouseId: 'wh-quar-1', // quarantine warehouse
              returnedQuantity: 5,
              bonusReturnedQuantity: 0,
              stockCondition: ReturnedStockCondition.SALEABLE, // mismatch
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects QUARANTINED return when sourced from STANDARD warehouse', async () => {
      await expect(
        service.createPurchaseReturn({
          grnId: 'grn-1',
          reason: PurchaseReturnReason.REGULATORY_RECALL,
          items: [
            {
              grnItemId: 'grn-item-1',
              sourceWarehouseId: 'wh-std-1', // standard warehouse
              returnedQuantity: 5,
              bonusReturnedQuantity: 0,
              stockCondition: ReturnedStockCondition.QUARANTINED, // mismatch
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelPurchaseReturn', () => {
    it('cancels purchase return, creates compensating stock re-entry and recalculates ground truth settlement', async () => {
      const result = await service.cancelPurchaseReturn('pret-1', {
        cancellationReason: 'Supplier refused return claim',
      });

      expect(result).toBeDefined();
      expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pret-1' },
          data: expect.objectContaining({
            status: PurchaseReturnStatus.CANCELLED,
            cancellationReason: 'Supplier refused return claim',
          }),
        }),
      );
      // Verify compensating stock re-entry
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'PURCHASE_RECEIPT',
            quantity: 10,
          }),
        }),
      );
      // Verify supplier ledger adjustment entry
      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: 'ADJUSTMENT',
            supplierId: 'sup-1',
          }),
        }),
      );
    });

    it('rejects cancellation if return is already cancelled', async () => {
      prisma.purchaseReturn.findFirst.mockResolvedValueOnce({
        id: 'pret-1',
        returnNumber: 'PRET-00001',
        status: PurchaseReturnStatus.CANCELLED,
      });

      await expect(
        service.cancelPurchaseReturn('pret-1', {
          cancellationReason: 'Repeat cancel',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
