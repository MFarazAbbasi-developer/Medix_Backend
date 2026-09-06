import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { FefoService } from '../inventory/fefo.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('SalesService', () => {
  let service: SalesService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;
  let fefoService: any;

  const mockCustomer = {
    id: 'cust-1',
    code: 'CUST-001',
    name: 'Al-Shifa Pharmacy',
    customer_type: 'RETAIL_PHARMACY',
    credit_limit: new Decimal('50000.00'),
    credit_days: 30,
    current_balance: new Decimal('0.00'),
    default_discount_percentage: new Decimal('0.00'),
    is_tax_exempt: false,
    is_active: true,
  };

  const mockProduct = {
    id: 'prod-1',
    organizationId: 'org-1',
    name: 'Panadol 500mg',
    sku: 'MED-PAN-500',
    taxPercentage: new Decimal('0.00'),
    isActive: true,
  };

  const mockBatch = {
    id: 'batch-1',
    product_id: 'prod-1',
    batch_number: 'BN-101',
    expiry_date: new Date(Date.now() + 86400000 * 300),
    purchase_cost: new Decimal('40.00'),
    trade_price: new Decimal('48.00'),
    retail_price: new Decimal('55.00'),
  };

  const mockWarehouse = {
    id: 'wh-1',
    branchId: 'branch-1',
    organizationId: 'org-1',
    name: 'Main Storage',
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Test Org' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: 'branch-1', isHeadOffice: true }),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue(mockCustomer),
        update: vi.fn().mockResolvedValue(mockCustomer),
      },
      warehouse: {
        findFirst: vi.fn().mockResolvedValue(mockWarehouse),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue(mockProduct),
      },
      batch: {
        findFirst: vi.fn().mockResolvedValue(mockBatch),
        findMany: vi.fn().mockResolvedValue([mockBatch]),
        findUnique: vi.fn().mockResolvedValue(mockBatch),
      },
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: 'TP' }),
      },
      customerPricingRule: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      salesInvoice: {
        create: vi.fn().mockResolvedValue({
          id: 'inv-1',
          invoiceNumber: 'INV-00001',
          status: 'POSTED',
          netTotal: new Decimal('480.00'),
          paidAmount: new Decimal('480.00'),
          balanceAmount: new Decimal('0.00'),
        }),
        findFirst: vi.fn().mockResolvedValue({
          id: 'inv-1',
          invoiceNumber: 'INV-00001',
          status: 'POSTED',
          customerId: 'cust-1',
          branchId: 'branch-1',
          warehouseId: 'wh-1',
          netTotal: new Decimal('480.00'),
          paidAmount: new Decimal('480.00'),
          balanceAmount: new Decimal('0.00'),
        }),
        update: vi.fn().mockResolvedValue({ id: 'inv-1', status: 'CANCELLED' }),
        delete: vi.fn().mockResolvedValue({ id: 'inv-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({
          _sum: { netTotal: new Decimal(0), paidAmount: new Decimal(0), balanceAmount: new Decimal(0), grossProfit: new Decimal(0) },
          _count: { id: 0 },
        }),
      },
      salesInvoiceItem: {
        create: vi.fn().mockResolvedValue({ id: 'item-1' }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'item-1',
            salesInvoiceId: 'inv-1',
            productId: 'prod-1',
            batchId: 'batch-1',
            totalQuantity: 10,
            unitCost: new Decimal('40.00'),
          },
        ]),
      },
      salesInvoicePayment: {
        create: vi.fn().mockResolvedValue({ id: 'pay-1' }),
      },
      stockMovement: {
        create: vi.fn().mockResolvedValue({ id: 'sm-1' }),
      },
      customerLedgerEntry: {
        create: vi.fn().mockResolvedValue({ id: 'cle-1' }),
      },
      $queryRaw: vi.fn().mockImplementation((query) => {
        const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';
        if (text.includes('customers')) {
          return [mockCustomer];
        }
        if (text.includes('batches')) {
          return [mockBatch];
        }
        if (text.includes('stock_movements')) {
          return [{ balance: 100 }];
        }
        if (text.includes('sales_invoices')) {
          return [
            {
              id: 'inv-1',
              status: 'POSTED',
              customer_id: 'cust-1',
              branch_id: 'branch-1',
              warehouse_id: 'wh-1',
              invoice_number: 'INV-00001',
              net_total: new Decimal('480.00'),
              paid_amount: new Decimal('480.00'),
              balance_amount: new Decimal('0.00'),
            },
          ];
        }
        return [];
      }),
      $transaction: vi.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    auditService = { log: vi.fn().mockResolvedValue(undefined) };
    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'INV-00001',
        seriesId: 'series-1',
        sequence: 1,
      }),
    };
    fefoService = {
      allocate: vi.fn().mockResolvedValue({
        productId: 'prod-1',
        requestedQuantity: 10,
        allocatedQuantity: 10,
        shortfall: 0,
        isFullyAllocated: true,
        allocations: [
          {
            batchId: 'batch-1',
            batchNumber: 'BN-101',
            allocatedQuantity: 10,
            availableQuantity: 100,
            tradePrice: 48,
            retailPrice: 55,
            purchaseCost: 40,
          },
        ],
      }),
    };

    service = new SalesService(
      prisma as PrismaService,
      auditService as AuditService,
      numberingService as NumberingService,
      fefoService as FefoService,
    );
  });

  it('provides advisory FEFO allocation preview', async () => {
    const preview = await service.previewFefo({
      warehouseId: 'wh-1',
      productId: 'prod-1',
      requestedQuantity: 10,
      customerId: 'cust-1',
    });

    expect(fefoService.allocate).toHaveBeenCalled();
    expect(preview.allocation.isFullyAllocated).toBe(true);
    expect(preview.allocation.allocations[0].batchNumber).toBe('BN-101');
  });

  it('creates and immediately posts sales invoice with atomic stock deduction and ledger logging', async () => {
    const res = await service.createSalesInvoice(
      {
        customerId: 'cust-1',
        warehouseId: 'wh-1',
        paymentMethod: 'CASH' as any,
        items: [
          {
            productId: 'prod-1',
            billedQuantity: 10,
            bonusQuantity: 0,
          },
        ],
      },
      'user-1',
    );

    expect(numberingService.generateNextNumber).toHaveBeenCalled();
    expect(prisma.salesInvoice.create).toHaveBeenCalled();
    expect(prisma.salesInvoiceItem.create).toHaveBeenCalled();
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: 'SALES_ISSUE',
          quantity: -10,
        }),
      }),
    );
    expect(prisma.customerLedgerEntry.create).toHaveBeenCalled();
    expect(prisma.customer.update).toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalled();
    expect(res).toBeDefined();
  });

  it('rejects selling price exceeding statutory Maximum Retail Price (MRP)', async () => {
    await expect(
      service.createSalesInvoice(
        {
          customerId: 'cust-1',
          warehouseId: 'wh-1',
          items: [
            {
              productId: 'prod-1',
              billedQuantity: 10,
              unitPrice: 60, // Exceeds MRP 55.00
            },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('saves parked draft without consuming sequential invoice number', async () => {
    prisma.salesInvoice.create.mockResolvedValueOnce({
      id: 'dft-1',
      draftNumber: 'DFT-123456',
      status: 'DRAFT',
    });

    const draft = await service.createSalesInvoice(
      {
        customerId: 'cust-1',
        warehouseId: 'wh-1',
        isDraft: true,
        items: [
          {
            productId: 'prod-1',
            billedQuantity: 5,
          },
        ],
      },
      'user-1',
    );

    expect(numberingService.generateNextNumber).not.toHaveBeenCalled();
    expect(prisma.stockMovement.create).not.toHaveBeenCalled();
    expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
    expect(draft.status).toBe('DRAFT');
  });

  it('cancels posted sales invoice with compensating stock restoration and ledger refund', async () => {
    const cancelled = await service.cancelSalesInvoice(
      'inv-1',
      'user-1',
      {
        cancellationReason: 'Wrong medicine dispensed by cashier',
      },
    );

    expect(prisma.stockMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          movementType: 'SALES_RETURN',
          quantity: 10, // Restored stock
        }),
      }),
    );
    expect(prisma.customerLedgerEntry.create).toHaveBeenCalled();
    expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CANCELLED' }),
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CANCEL_SALES_INVOICE' }),
    );
    expect(cancelled).toBeDefined();
  });
});
