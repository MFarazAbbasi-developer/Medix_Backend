import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesReturnService } from './sales-return.service';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DocumentType,
  SalesReturnStatus,
  SalesInvoiceStatus,
  ReturnedStockCondition,
  ReturnStockDisposition,
  ReturnRefundMode,
  ReturnReason,
} from '@prisma/client';

describe('SalesReturnService (Phase 20H Dispositions)', () => {
  let service: SalesReturnService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;

  const mockCustomer = {
    id: 'cust-1',
    organizationId: 'org-1',
    name: 'Al-Shifa Pharmacy',
    current_balance: new Decimal('10000.00'),
    is_active: true,
  };

  const mockInvoice = {
    id: 'inv-1',
    branch_id: 'branch-1',
    customer_id: 'cust-1',
    invoice_number: 'INV-00001',
    net_total: new Decimal('10000.00'),
    paid_amount: new Decimal('6000.00'),
    balance_amount: new Decimal('4000.00'),
    status: SalesInvoiceStatus.POSTED,
  };

  const mockInvoiceItem = {
    id: 'inv-item-1',
    salesInvoiceId: 'inv-1',
    productId: 'prod-1',
    batchId: 'batch-1',
    batchNumber: 'BAT-2026-001',
    expiryDate: new Date('2028-12-31'),
    billedQuantity: 100,
    bonusQuantity: 10,
    totalQuantity: 110,
    unitCost: new Decimal('70.00'),
    tradePrice: new Decimal('90.00'),
    retailPrice: new Decimal('100.00'),
    unitPrice: new Decimal('90.00'),
    discountPercentage: new Decimal('0.00'),
    taxPercentage: new Decimal('0.00'),
    batch: { id: 'batch-1', status: 'ACTIVE', expiryDate: new Date('2028-12-31') },
    product: { id: 'prod-1', name: 'Amoxicillin 500mg' },
  };

  const mockStandardWarehouse = {
    id: 'wh-std',
    organizationId: 'org-1',
    branchId: 'branch-1',
    name: 'Main Warehouse',
    code: 'WH-MAIN',
    warehouseType: 'STANDARD',
  };

  const mockQuarantineWarehouse = {
    id: 'wh-quar',
    organizationId: 'org-1',
    branchId: 'branch-1',
    name: 'Quarantine Warehouse',
    code: 'WH-QUAR',
    warehouseType: 'QUARANTINE',
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue(mockCustomer),
        update: vi.fn().mockResolvedValue(mockCustomer),
      },
      salesInvoice: {
        findFirst: vi.fn().mockResolvedValue(mockInvoice),
        update: vi.fn().mockResolvedValue(mockInvoice),
      },
      salesInvoiceItem: {
        findMany: vi.fn().mockResolvedValue([mockInvoiceItem]),
      },
      salesInvoicePayment: {
        findMany: vi.fn().mockResolvedValue([{ amount: new Decimal('6000.00') }]),
      },
      salesReturn: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'sret-1',
          ...data,
        })),
        update: vi.fn(),
      },
      salesReturnItem: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 'sret-item-1',
          ...data,
        })),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      customerLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'cle-1' }),
      },
      warehouse: {
        findMany: vi.fn().mockImplementation(({ where }) => {
          const ids = where.id.in;
          const result = [];
          if (ids.includes('wh-std')) result.push(mockStandardWarehouse);
          if (ids.includes('wh-quar')) result.push(mockQuarantineWarehouse);
          return Promise.resolve(result);
        }),
      },
      $transaction: vi.fn().mockImplementation((callback) => callback(prisma)),
      $queryRaw: vi.fn().mockImplementation((query) => {
        const queryStr = query.strings ? query.strings.join(' ') : String(query);
        if (queryStr.includes('FROM sales_invoices') || queryStr.includes('sales_invoices')) {
          return Promise.resolve([mockInvoice]);
        }
        if (queryStr.includes('FROM customers') || queryStr.includes('customers')) {
          return Promise.resolve([mockCustomer]);
        }
        return Promise.resolve([]);
      }),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'SRET-00001',
        seriesId: 'series-1',
        sequence: 1,
      }),
    };

    service = new SalesReturnService(prisma, auditService, numberingService);
  });

  describe('createSalesReturn (Disposition Rules)', () => {
    it('should create sales return with RESTOCK_SALEABLE into a STANDARD warehouse', async () => {
      const result = await service.createSalesReturn(
        {
          salesInvoiceId: 'inv-1',
          reason: ReturnReason.CUSTOMER_RETURN,
          refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
          items: [
            {
              salesInvoiceItemId: 'inv-item-1',
              returnedQuantity: 10,
              bonusReturnedQuantity: 1,
              disposition: ReturnStockDisposition.RESTOCK_SALEABLE,
              destinationWarehouseId: 'wh-std',
            },
          ],
        },
        'user-1',
      );

      expect(prisma.salesReturn.create).toHaveBeenCalled();
      expect(prisma.salesReturnItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            returnedQuantity: 10,
            bonusReturnedQuantity: 1,
            stockCondition: ReturnedStockCondition.SALEABLE,
            disposition: ReturnStockDisposition.RESTOCK_SALEABLE,
          }),
        }),
      );
    });

    it('should reject RESTOCK_SALEABLE if destination warehouse is QUARANTINE', async () => {
      await expect(
        service.createSalesReturn(
          {
            salesInvoiceId: 'inv-1',
            reason: ReturnReason.CUSTOMER_RETURN,
            refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
            items: [
              {
                salesInvoiceItemId: 'inv-item-1',
                returnedQuantity: 10,
                disposition: ReturnStockDisposition.RESTOCK_SALEABLE,
                destinationWarehouseId: 'wh-quar',
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should accept RETURN_TO_SUPPLIER into QUARANTINE warehouse', async () => {
      await service.createSalesReturn(
        {
          salesInvoiceId: 'inv-1',
          reason: ReturnReason.DAMAGED_IN_TRANSIT,
          refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
          items: [
            {
              salesInvoiceItemId: 'inv-item-1',
              returnedQuantity: 5,
              disposition: ReturnStockDisposition.RETURN_TO_SUPPLIER,
              destinationWarehouseId: 'wh-quar',
            },
          ],
        },
        'user-1',
      );

      expect(prisma.salesReturnItem.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            stockCondition: ReturnedStockCondition.QUARANTINED,
            disposition: ReturnStockDisposition.RETURN_TO_SUPPLIER,
          }),
        }),
      );
    });

    it('should reject RESTOCK_SALEABLE for expired batches', async () => {
      const expiredItem = {
        ...mockInvoiceItem,
        id: 'inv-item-expired',
        expiryDate: new Date('2020-01-01'),
        batch: { id: 'batch-exp', status: 'ACTIVE', expiryDate: new Date('2020-01-01') },
      };
      prisma.salesInvoiceItem.findMany.mockResolvedValue([expiredItem]);

      await expect(
        service.createSalesReturn(
          {
            salesInvoiceId: 'inv-1',
            reason: ReturnReason.EXPIRED_NEAR_EXPIRY,
            refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
            items: [
              {
                salesInvoiceItemId: 'inv-item-expired',
                returnedQuantity: 5,
                disposition: ReturnStockDisposition.RESTOCK_SALEABLE,
                destinationWarehouseId: 'wh-std',
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
