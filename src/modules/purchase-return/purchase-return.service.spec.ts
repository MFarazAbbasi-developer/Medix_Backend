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

describe('PurchaseReturnService (Phase 20H Lifecycle & RGA)', () => {
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

  const mockDraftReturn = {
    id: 'pret-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    supplierId: 'sup-1',
    grnId: 'grn-1',
    returnNumber: 'PRET-00001',
    challanNumber: null,
    rgaNumber: 'RGA-12345',
    status: PurchaseReturnStatus.DRAFT,
    reason: PurchaseReturnReason.DEFECTIVE_BATCH,
    subtotal: new Decimal('1000.00'),
    discountAmount: new Decimal('100.00'),
    taxAmount: new Decimal('45.00'),
    netTotal: new Decimal('945.00'),
    branch_id: 'branch-1',
    supplier_id: 'sup-1',
    grn_id: 'grn-1',
    return_number: 'PRET-00001',
    net_total: new Decimal('945.00'),
    rga_number: 'RGA-12345',
    supplier: mockSupplier,
    grn: mockGrn,
    items: [
      {
        id: 'pret-item-1',
        purchaseReturnId: 'pret-1',
        grnItemId: 'grn-item-1',
        productId: 'prod-1',
        batchId: 'batch-1',
        batchNumber: 'BATCH-2026-A',
        sourceWarehouseId: 'wh-std-1',
        returnedQuantity: 10,
        bonusReturnedQuantity: 1,
        totalReturnedQuantity: 11,
        stockCondition: ReturnedStockCondition.SALEABLE,
        unitCost: new Decimal('100.00'),
        lineTotal: new Decimal('945.00'),
        sourceWarehouse: mockWarehouseStandard,
        product: mockGrnItem.product,
        batch: mockGrnItem.batch,
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
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
        findFirst: vi.fn().mockResolvedValue(mockDraftReturn),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'pret-1',
          ...data,
        })),
        update: vi.fn().mockImplementation(({ where, data }) => ({
          ...mockDraftReturn,
          ...data,
        })),
        count: vi.fn().mockResolvedValue(1),
        aggregate: vi.fn().mockResolvedValue({ _sum: { netTotal: new Decimal(945) } }),
      },
      purchaseReturnItem: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        findMany: vi.fn().mockResolvedValue(mockDraftReturn.items),
      },
      stockMovement: {
        findMany: vi.fn().mockResolvedValue([{ quantity: 100 }]),
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      supplierLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'sle-1' }),
      },
      warehouse: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'wh-std-1') return Promise.resolve(mockWarehouseStandard);
          if (where.id === 'wh-quar-1') return Promise.resolve(mockWarehouseQuarantine);
          return Promise.resolve(null);
        }),
      },
      batch: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'batch-1',
          batchNumber: 'BATCH-2026-A',
          purchaseCost: new Decimal('100.00'),
          expiryDate: new Date('2027-12-31'),
          status: 'ACTIVE',
        }),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue(mockGrnItem.product),
      },
      supplierPaymentAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
      $queryRaw: vi.fn().mockImplementation((query) => {
        const queryStr = query.strings ? query.strings.join(' ') : String(query);
        if (queryStr.includes('FROM goods_receive_notes')) {
          return Promise.resolve([mockGrn]);
        }
        if (queryStr.includes('FROM suppliers')) {
          return Promise.resolve([mockSupplier]);
        }
        if (queryStr.includes('FROM purchase_returns')) {
          return Promise.resolve([mockDraftReturn]);
        }
        return Promise.resolve([]);
      }),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockImplementation((docType) => {
        if (docType === DocumentType.SUPPLIER_RETURN_CHALLAN) {
          return Promise.resolve({
            documentNumber: 'SRCH-00001',
            seriesId: 'series-challan-1',
            sequence: 1,
          });
        }
        return Promise.resolve({
          documentNumber: 'PRET-00001',
          seriesId: 'series-pret-1',
          sequence: 1,
        });
      }),
    };

    service = new PurchaseReturnService(prisma, auditService, numberingService);
  });

  describe('createPurchaseReturn (DRAFT only)', () => {
    it('should create purchase return strictly in DRAFT status with zero stock & ledger side-effects', async () => {
      const result = await service.createPurchaseReturn(
        {
          grnId: 'grn-1',
          reason: PurchaseReturnReason.DEFECTIVE_BATCH,
          rgaNumber: 'RGA-999',
          items: [
            {
              grnItemId: 'grn-item-1',
              returnedQuantity: 10,
              bonusReturnedQuantity: 1,
              stockCondition: ReturnedStockCondition.SALEABLE,
              sourceWarehouseId: 'wh-std-1',
            },
          ],
        },
        'user-1',
      );

      expect(prisma.purchaseReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: PurchaseReturnStatus.DRAFT,
            rgaNumber: 'RGA-999',
          }),
        }),
      );

      // In DRAFT, no stock movement and no supplier ledger entries are created!
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.supplierLedgerEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('dispatchPurchaseReturn', () => {
    it('should deduct physical stock and allocate Supplier Return Challan number (SRCH-xxxxx)', async () => {
      await service.dispatchPurchaseReturn('pret-1', 'user-1');

      // Stock deducted with negative quantity
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'PURCHASE_RETURN',
            quantity: -11, // totalReturnedQuantity
            referenceType: 'PURCHASE_RETURN',
            referenceId: 'pret-1',
          }),
        }),
      );

      // Numbering for challan
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.SUPPLIER_RETURN_CHALLAN,
        'branch-1',
        expect.anything(),
      );

      // Status updated to DISPATCHED
      expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pret-1' },
          data: expect.objectContaining({
            status: PurchaseReturnStatus.DISPATCHED,
            challanNumber: 'SRCH-00001',
          }),
        }),
      );
    });
  });

  describe('completePurchaseReturn', () => {
    it('should post supplier ledger DEBIT_NOTE and update GRN balance', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const queryStr = query.strings ? query.strings.join(' ') : String(query);
        if (queryStr.includes('FROM purchase_returns')) {
          return Promise.resolve([{ ...mockDraftReturn, status: PurchaseReturnStatus.DISPATCHED }]);
        }
        if (queryStr.includes('FROM suppliers')) {
          return Promise.resolve([mockSupplier]);
        }
        if (queryStr.includes('FROM goods_receive_notes')) {
          return Promise.resolve([mockGrn]);
        }
        return Promise.resolve([]);
      });

      await service.completePurchaseReturn('pret-1', { vendorCreditNoteNumber: 'VCN-888' }, 'user-1');

      expect(prisma.supplierLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: 'DEBIT_NOTE',
            referenceNumber: 'PRET-00001',
          }),
        }),
      );

      expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pret-1' },
          data: expect.objectContaining({
            status: PurchaseReturnStatus.COMPLETED,
            vendorCreditNoteNumber: 'VCN-888',
          }),
        }),
      );
    });
  });

  describe('cancelPurchaseReturn', () => {
    it('should re-inject stock on cancellation of a DISPATCHED return', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const queryStr = query.strings ? query.strings.join(' ') : String(query);
        if (queryStr.includes('FROM purchase_returns')) {
          return Promise.resolve([{ ...mockDraftReturn, status: PurchaseReturnStatus.DISPATCHED }]);
        }
        return Promise.resolve([]);
      });

      await service.cancelPurchaseReturn(
        'pret-1',
        { cancellationReason: 'Vendor refused authorization' },
        'user-1',
      );

      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'PURCHASE_RECEIPT',
            quantity: 11, // Positive re-entry
            referenceType: 'PURCHASE_RETURN_CANCEL',
            referenceId: 'pret-1',
          }),
        }),
      );

      expect(prisma.purchaseReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pret-1' },
          data: expect.objectContaining({
            status: PurchaseReturnStatus.CANCELLED,
          }),
        }),
      );
    });
  });
});
