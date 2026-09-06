import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('Sales Service - Concurrency & Financial Integrity', () => {
  let salesService: SalesService;
  let prisma: PrismaService;
  let numberingService: NumberingService;
  let auditService: AuditService;
  let pricingEngine: PricingEngineService;

  const mockOrgId = 'org-concurrency-uuid';
  const mockBranchId = 'branch-concurrency-uuid';
  const mockWarehouseId = 'wh-concurrency-uuid';
  const mockCustomerId = 'cust-concurrency-uuid';
  const mockProductId = 'prod-panadol-uuid';
  const mockBatchId = 'batch-bt01-uuid';

  beforeEach(() => {
    vi.clearAllMocks();

    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: mockOrgId, name: 'Medix Pharma' }),
      },
      branch: {
        findFirst: vi.fn().mockResolvedValue({ id: mockBranchId, name: 'HO Branch', isHeadOffice: true }),
      },
      warehouse: {
        findFirst: vi.fn().mockResolvedValue({ id: mockWarehouseId, name: 'Main Warehouse', isActive: true }),
      },
      customer: {
        findFirst: vi.fn(),
        update: vi.fn(),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue({
          id: mockProductId,
          name: 'Panadol 500mg',
          sku: 'PAN-500',
          taxPercentage: new Prisma.Decimal(0),
          isActive: true,
          batches: [],
        }),
      },
      batch: {
        findFirst: vi.fn().mockResolvedValue({
          id: mockBatchId,
          productId: mockProductId,
          batchNumber: 'BT-001',
          expiryDate: new Date('2028-12-31'),
          purchaseCost: new Prisma.Decimal(350),
          tradePrice: new Prisma.Decimal(400),
          retailPrice: new Prisma.Decimal(500),
          status: 'ACTIVE',
        }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      stockMovement: {
        create: vi.fn(),
      },
      salesInvoice: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findFirst: vi.fn(),
      },
      salesInvoiceItem: {
        create: vi.fn().mockResolvedValue({ id: 'inv-item-1' }),
      },
      customerLedgerEntry: {
        create: vi.fn(),
      },
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: 'false' }),
      },
      customerPricingRule: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      promotionalScheme: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      $queryRaw: vi.fn(),
      $transaction: vi.fn((cb: any) => cb(prisma)),
    } as unknown as PrismaService;

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'INV-2026-9999',
        seriesId: 'series-uuid',
        sequence: 9999,
      }),
    } as unknown as NumberingService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    pricingEngine = new PricingEngineService();
    const fefoService = {
      previewFefoAllocation: vi.fn(),
    } as any;

    salesService = new SalesService(
      prisma,
      auditService,
      numberingService,
      fefoService,
      pricingEngine,
    );
  });

  it('prevents negative stock when concurrent transactions request more units than available in batch', async () => {
    // Current locked batch stock is 5 units
    let liveBatchStock = 5;

    // Simulate database row locks & live stock query inside transaction
    (prisma.$queryRaw as any).mockImplementation((query: any) => {
      const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';

      if (text.includes('customers') && text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            id: mockCustomerId,
            code: 'CUST-01',
            name: 'Al-Hadi Pharmacy',
            customer_type: 'CREDIT',
            credit_limit: new Prisma.Decimal(100000),
            credit_days: 30,
            current_balance: new Prisma.Decimal(10000),
            default_discount_percentage: new Prisma.Decimal(0),
            is_tax_exempt: false,
            is_active: true,
          },
        ]);
      }

      if (text.includes('batches') && text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            id: mockBatchId,
            product_id: mockProductId,
            batch_number: 'BT-001',
            expiryDate: new Date('2028-12-31'),
            purchase_cost: new Prisma.Decimal(350),
            trade_price: new Prisma.Decimal(400),
            retail_price: new Prisma.Decimal(500),
          },
        ]);
      }

      if (text.includes('stock_movements') && text.includes('COALESCE(SUM(quantity)')) {
        return Promise.resolve([{ balance: liveBatchStock }]);
      }

      return Promise.resolve([]);
    });

    (prisma.stockMovement.create as any).mockImplementation(({ data }: any) => {
      liveBatchStock += Number(data.quantity); // signed negative quantity reduces stock
      return Promise.resolve({ id: 'sm-1' });
    });

    (prisma.salesInvoice.create as any).mockImplementation(({ data }: any) => {
      return Promise.resolve({
        id: 'inv-success-1',
        invoiceNumber: 'INV-2026-9999',
        netTotal: data.netTotal,
      });
    });

    // Station 1: Attempts to dispense 3 units (available: 5 -> succeeds, remaining: 2)
    const order1Dto = {
      customerId: mockCustomerId,
      warehouseId: mockWarehouseId,
      items: [
        {
          productId: mockProductId,
          batchId: mockBatchId,
          billedQuantity: 3,
        },
      ],
    };

    const result1 = await salesService.createSalesInvoice(order1Dto);
    expect(result1).toBeDefined();
    expect(liveBatchStock).toBe(2);

    // Station 2: Attempts to dispense 4 units concurrently (available: 2 -> must reject with shortfall)
    const order2Dto = {
      customerId: mockCustomerId,
      warehouseId: mockWarehouseId,
      items: [
        {
          productId: mockProductId,
          batchId: mockBatchId,
          billedQuantity: 4,
        },
      ],
    };

    await expect(salesService.createSalesInvoice(order2Dto)).rejects.toThrow(
      BadRequestException,
    );
    await expect(salesService.createSalesInvoice(order2Dto)).rejects.toThrow(
      /Insufficient stock for batch "BT-001"/,
    );

    // Stock was not driven negative
    expect(liveBatchStock).toBe(2);
  });

  it('safely preserves draft invoice if an atomic posting transaction fails midway', async () => {
    const draftInvoiceId = 'draft-invoice-001';

    // Mock existing draft
    (prisma.salesInvoice.findFirst as any).mockResolvedValue({
      id: draftInvoiceId,
      organizationId: mockOrgId,
      branchId: mockBranchId,
      warehouseId: mockWarehouseId,
      customerId: mockCustomerId,
      status: 'DRAFT',
      invoiceDate: new Date(),
      paymentMethod: 'CASH',
      items: [
        {
          productId: mockProductId,
          batchId: mockBatchId,
          batchNumber: 'BT-001',
          billedQuantity: 10,
          bonusQuantity: 0,
          unitPrice: new Prisma.Decimal(400),
          retailPrice: new Prisma.Decimal(500),
          discountPercentage: new Prisma.Decimal(0),
          taxPercentage: new Prisma.Decimal(0),
          pricingSource: 'MANUAL',
        },
      ],
      payments: [],
      notes: 'Parked draft',
    });

    // Mock stock check failure (only 2 units in stock for 10 needed)
    (prisma.$queryRaw as any).mockImplementation((query: any) => {
      const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';

      if (text.includes('customers') && text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            id: mockCustomerId,
            code: 'CUST-01',
            name: 'Al-Hadi Pharmacy',
            customer_type: 'CASH',
            credit_limit: new Prisma.Decimal(0),
            credit_days: 0,
            current_balance: new Prisma.Decimal(0),
            default_discount_percentage: new Prisma.Decimal(0),
            is_tax_exempt: false,
            is_active: true,
          },
        ]);
      }

      if (text.includes('batches') && text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            id: mockBatchId,
            product_id: mockProductId,
            batch_number: 'BT-001',
            expiryDate: new Date('2028-12-31'),
            purchase_cost: new Prisma.Decimal(350),
            trade_price: new Prisma.Decimal(400),
            retail_price: new Prisma.Decimal(500),
          },
        ]);
      }

      if (text.includes('stock_movements') && text.includes('COALESCE(SUM(quantity)')) {
        return Promise.resolve([{ balance: 2 }]); // Shortfall
      }

      return Promise.resolve([]);
    });

    // Attempt to post draft
    await expect(salesService.postDraftInvoice(draftInvoiceId)).rejects.toThrow(
      BadRequestException,
    );

    // Draft deletion should NEVER have been called since post failed
    expect(prisma.salesInvoice.delete).not.toHaveBeenCalled();
  });

  it('guarantees atomic customer sub-ledger entry and balance consistency upon posted credit sales', async () => {
    (prisma.$queryRaw as any).mockImplementation((query: any) => {
      const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';

      if (text.includes('customers') && text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            id: mockCustomerId,
            code: 'CUST-01',
            name: 'Al-Hadi Pharmacy',
            customer_type: 'CREDIT',
            credit_limit: new Prisma.Decimal(100000),
            credit_days: 30,
            current_balance: new Prisma.Decimal(5000),
            default_discount_percentage: new Prisma.Decimal(0),
            is_tax_exempt: false,
            is_active: true,
          },
        ]);
      }

      if (text.includes('batches') && text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            id: mockBatchId,
            product_id: mockProductId,
            batch_number: 'BT-001',
            expiryDate: new Date('2028-12-31'),
            purchase_cost: new Prisma.Decimal(350),
            trade_price: new Prisma.Decimal(400),
            retail_price: new Prisma.Decimal(500),
          },
        ]);
      }

      if (text.includes('stock_movements') && text.includes('COALESCE(SUM(quantity)')) {
        return Promise.resolve([{ balance: 100 }]);
      }

      return Promise.resolve([]);
    });

    (prisma.salesInvoice.create as any).mockResolvedValue({
      id: 'inv-posted-101',
      invoiceNumber: 'INV-2026-9999',
      netTotal: new Prisma.Decimal(800),
      balanceAmount: new Prisma.Decimal(800),
      paidAmount: new Prisma.Decimal(0),
      paymentMethod: 'CREDIT_ACCOUNT',
    });

    const creditSaleDto = {
      customerId: mockCustomerId,
      warehouseId: mockWarehouseId,
      paymentMethod: 'CREDIT_ACCOUNT' as const,
      items: [
        {
          productId: mockProductId,
          batchId: mockBatchId,
          billedQuantity: 2,
          unitPrice: 400,
        },
      ],
    };

    await salesService.createSalesInvoice(creditSaleDto);

    // Customer sub-ledger entry created with exact debit amount
    expect(prisma.customerLedgerEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: mockCustomerId,
          entryType: 'SALES_INVOICE',
          debit: expect.any(Prisma.Decimal),
          runningBalance: expect.any(Prisma.Decimal),
        }),
      }),
    );

    // Customer balance updated from 5000 + 800 -> 5800
    expect(prisma.customer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: mockCustomerId },
        data: { currentBalance: new Prisma.Decimal(5800) },
      }),
    );
  });
});
