import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesReturnService } from './sales-return.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DocumentType,
  SalesReturnStatus,
  SalesInvoiceStatus,
  ReturnedStockCondition,
  ReturnRefundMode,
  ReturnReason,
} from '@prisma/client';

describe('SalesReturnService', () => {
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
      warehouse: {
        findMany: vi.fn().mockResolvedValue([mockStandardWarehouse, mockQuarantineWarehouse]),
      },
      salesReturn: {
        create: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'sret-1',
            returnNumber: 'SRET-00001',
            ...data,
          }),
        ),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({
          id: 'sret-1',
          returnNumber: 'SRET-00001',
          branchId: 'branch-1',
          customerId: 'cust-1',
          salesInvoiceId: 'inv-1',
          netTotal: new Decimal('1800.00'),
          refundAmount: new Decimal('0.00'),
          status: SalesReturnStatus.POSTED,
          items: [
            {
              id: 'sret-item-1',
              salesInvoiceItemId: 'inv-item-1',
              productId: 'prod-1',
              batchId: 'batch-1',
              batchNumber: 'BAT-2026-001',
              destinationWarehouseId: 'wh-std',
              returnedQuantity: 20,
              bonusReturnedQuantity: 0,
              totalReturnedQuantity: 20,
              unitCost: new Decimal('70.00'),
              destinationWarehouse: mockStandardWarehouse,
            },
          ],
        }),
        update: vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 'sret-1',
            returnNumber: 'SRET-00001',
            ...data,
          }),
        ),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { netTotal: new Decimal(0), refundAmount: new Decimal(0), totalCostPrice: new Decimal(0), grossProfit: new Decimal(0) },
        }),
      },
      salesReturnItem: {
        create: vi.fn().mockResolvedValue({ id: 'sret-item-1' }),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
        findMany: vi.fn().mockResolvedValue([{ quantity: 50 }]), // 50 available in warehouse
      },
      customerLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'cle-1' }),
      },
      customerPaymentAllocation: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn().mockImplementation((query: any) => {
        const text =
          typeof query === 'string'
            ? query
            : query?.strings?.join(' ') || query?.sql || query?.text || String(query);
        if (text.includes('customers')) {
          return [mockCustomer];
        }
        if (text.includes('sales_invoices')) {
          return [mockInvoice];
        }
        return [];
      }),
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'SRET-00001',
        sequence: 1,
      }),
    };

    service = new SalesReturnService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
      numberingService as unknown as NumberingService,
    );
  });

  describe('createSalesReturn', () => {
    it('creates saleable return to STANDARD warehouse and offsets outstanding balance', async () => {
      const result = await service.createSalesReturn(
        {
          salesInvoiceId: 'inv-1',
          reason: ReturnReason.CUSTOMER_RETURN,
          refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
          items: [
            {
              salesInvoiceItemId: 'inv-item-1',
              returnedQuantity: 20,
              stockCondition: ReturnedStockCondition.SALEABLE,
              destinationWarehouseId: 'wh-std',
            },
          ],
        },
        'user-1',
      );

      expect(result.id).toBe('sret-1');
      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        DocumentType.SALES_RETURN,
        'branch-1',
      );
      // Stock movement created
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'SALES_RETURN',
            quantity: 20,
            warehouseId: 'wh-std',
          }),
        }),
      );
      // Invoice balance reduced: 4000 - 1800 = 2200
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
        }),
      );
      // Customer balance reduced
      expect(prisma.customerLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            entryType: 'CREDIT_NOTE',
          }),
        }),
      );
    });

    it('creates quarantined return to QUARANTINE warehouse for damaged/defective items', async () => {
      const result = await service.createSalesReturn(
        {
          salesInvoiceId: 'inv-1',
          reason: ReturnReason.DEFECTIVE_PRODUCT,
          refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
          items: [
            {
              salesInvoiceItemId: 'inv-item-1',
              returnedQuantity: 10,
              stockCondition: ReturnedStockCondition.QUARANTINED,
              destinationWarehouseId: 'wh-quar',
            },
          ],
        },
        'user-1',
      );

      expect(result.id).toBe('sret-1');
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'SALES_RETURN',
            quantity: 10,
            warehouseId: 'wh-quar',
          }),
        }),
      );
    });

    it('rejects SALEABLE return into a QUARANTINE warehouse', async () => {
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
                stockCondition: ReturnedStockCondition.SALEABLE,
                destinationWarehouseId: 'wh-quar', // Mismatched
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects return of expired batch as SALEABLE', async () => {
      prisma.salesInvoiceItem.findMany.mockResolvedValueOnce([
        {
          ...mockInvoiceItem,
          expiryDate: new Date('2020-01-01'), // Expired
        },
      ]);

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
                stockCondition: ReturnedStockCondition.SALEABLE,
                destinationWarehouseId: 'wh-std',
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('supports immediate cash refund bounded by paid amount', async () => {
      // Net return value for 50 items @ 90 = 4500. Invoice paid amount is 6000.
      const result = await service.createSalesReturn(
        {
          salesInvoiceId: 'inv-1',
          reason: ReturnReason.CUSTOMER_RETURN,
          refundMode: ReturnRefundMode.CASH_REFUND,
          refundAmount: 4500,
          items: [
            {
              salesInvoiceItemId: 'inv-item-1',
              returnedQuantity: 50,
              stockCondition: ReturnedStockCondition.SALEABLE,
              destinationWarehouseId: 'wh-std',
            },
          ],
        },
        'user-1',
      );

      expect(result.id).toBe('sret-1');
      // Paired refund ledger entries created
      expect(prisma.customerLedgerEntry.create).toHaveBeenCalled();
    });

    it('rejects immediate cash refund exceeding paid amount on unpaid/partially-unpaid invoice', async () => {
      // Net return value: 80 items @ 90 = 7200. But invoice paid is only 6000!
      await expect(
        service.createSalesReturn(
          {
            salesInvoiceId: 'inv-1',
            reason: ReturnReason.CUSTOMER_RETURN,
            refundMode: ReturnRefundMode.CASH_REFUND,
            refundAmount: 7200,
            items: [
              {
                salesInvoiceItemId: 'inv-item-1',
                returnedQuantity: 80,
                stockCondition: ReturnedStockCondition.SALEABLE,
                destinationWarehouseId: 'wh-std',
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects return quantity exceeding original billed quantity', async () => {
      await expect(
        service.createSalesReturn(
          {
            salesInvoiceId: 'inv-1',
            reason: ReturnReason.CUSTOMER_RETURN,
            refundMode: ReturnRefundMode.CREDIT_ACCOUNT,
            items: [
              {
                salesInvoiceItemId: 'inv-item-1',
                returnedQuantity: 150, // Billed was 100
                stockCondition: ReturnedStockCondition.SALEABLE,
                destinationWarehouseId: 'wh-std',
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancelSalesReturn', () => {
    it('cancels return when stock is available in exact warehouse and restores invoice settlement', async () => {
      const result = await service.cancelSalesReturn(
        'sret-1',
        { cancellationReason: 'Return entered by mistake' },
        'user-1',
      );

      expect(result.status).toBe(SalesReturnStatus.CANCELLED);
      // Compensating stock deduction
      expect(prisma.stockMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'SALES_ISSUE',
            quantity: -20,
            warehouseId: 'wh-std',
          }),
        }),
      );
      // Settlement recalculated
      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
        }),
      );
      // Customer adjustment ledger entry
      expect(prisma.customerLedgerEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            entryType: 'ADJUSTMENT',
          }),
        }),
      );
    });

    it('rejects return cancellation if returned stock was consumed/moved from exact warehouse', async () => {
      // Mock only 5 units remaining in warehouse, but return had 20 units
      prisma.stockMovement.findMany.mockResolvedValueOnce([{ quantity: 5 }]);

      await expect(
        service.cancelSalesReturn(
          'sret-1',
          { cancellationReason: 'Stock already sold to another customer' },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects double cancellation of already cancelled return', async () => {
      prisma.salesReturn.findFirst.mockResolvedValueOnce({
        id: 'sret-1',
        returnNumber: 'SRET-00001',
        status: SalesReturnStatus.CANCELLED,
        items: [],
      });

      await expect(
        service.cancelSalesReturn(
          'sret-1',
          { cancellationReason: 'Duplicate attempt' },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });
});
