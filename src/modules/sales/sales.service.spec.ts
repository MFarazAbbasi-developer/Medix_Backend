import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesService } from './sales.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { FefoService } from '../inventory/fefo.service';
import { PricingEngineService } from '../pricing/pricing-engine.service';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('SalesService', () => {
  let service: SalesService;
  let pricingEngine: PricingEngineService;
  let prisma: any;
  let auditService: any;
  let numberingService: any;
  let fefoService: any;

  const mockCustomer = {
    id: 'cust-1',
    code: 'CUST-001',
    name: 'Al-Shifa Pharmacy',
    customer_type: 'RETAIL_PHARMACY',
    customerType: 'RETAIL_PHARMACY',
    credit_limit: new Decimal('50000.00'),
    credit_days: 30,
    current_balance: new Decimal('0.00'),
    default_discount_percentage: new Decimal('0.00'),
    defaultDiscountPercentage: new Decimal('0.00'),
    is_tax_exempt: false,
    isTaxExempt: false,
    is_active: true,
  };

  const mockProduct = {
    id: 'prod-1',
    organizationId: 'org-1',
    name: 'Panadol 500mg',
    sku: 'MED-PAN-500',
    taxPercentage: new Decimal('0.00'),
    isActive: true,
    batches: [
      {
        id: 'batch-1',
        productId: 'prod-1',
        batchNumber: 'BN-101',
        expiryDate: new Date(Date.now() + 86400000 * 300),
        purchaseCost: new Decimal('40.00'),
        tradePrice: new Decimal('48.00'),
        retailPrice: new Decimal('55.00'),
      },
    ],
  };

  const mockBatch = {
    id: 'batch-1',
    product_id: 'prod-1',
    productId: 'prod-1',
    batch_number: 'BN-101',
    batchNumber: 'BN-101',
    expiry_date: new Date(Date.now() + 86400000 * 300),
    expiryDate: new Date(Date.now() + 86400000 * 300),
    purchase_cost: new Decimal('40.00'),
    purchaseCost: new Decimal('40.00'),
    trade_price: new Decimal('48.00'),
    tradePrice: new Decimal('48.00'),
    retail_price: new Decimal('55.00'),
    retailPrice: new Decimal('55.00'),
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
        findMany: vi.fn().mockResolvedValue([]),
      },
      promotionalScheme: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      tillSession: {
        findFirst: vi.fn().mockResolvedValue({ id: 'till-session-1', status: 'OPEN' }),
      },
      customerDeliveryAddress: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'addr-1') {
            return Promise.resolve({
              id: 'addr-1',
              organizationId: 'org-1',
              customerId: 'cust-1',
              title: 'Main Branch Pharmacy',
              recipientName: 'Dr. Tariq',
              phone: '03001234567',
              address: 'Shop 12, Main Market',
              city: 'Karachi',
              deliveryInstructions: 'Deliver 10am-4pm',
              isActive: true,
            });
          }
          if (where.id === 'addr-inactive') {
            return Promise.resolve({
              id: 'addr-inactive',
              organizationId: 'org-1',
              customerId: 'cust-1',
              title: 'Closed Site',
              address: 'Some Address',
              isActive: false,
            });
          }
          if (where.id === 'addr-other-cust') {
            return Promise.resolve({
              id: 'addr-other-cust',
              organizationId: 'org-1',
              customerId: 'cust-other',
              title: 'Other Cust Address',
              address: 'Some Address',
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
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
      deliveryOrder: {
        update: vi.fn().mockResolvedValue({ id: 'do-1', status: 'CANCELLED' }),
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

    pricingEngine = new PricingEngineService();

    service = new SalesService(
      prisma as PrismaService,
      auditService as AuditService,
      numberingService as NumberingService,
      fefoService as FefoService,
      pricingEngine,
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

  it('allows sale and returns creditWarnings in soft mode when ENFORCE_CREDIT_LIMIT is false', async () => {
    // Current balance 49,900 + new invoice 500 = 50,400 > credit limit 50,000
    const overLimitCustomer = {
      ...mockCustomer,
      current_balance: new Decimal('49900.00'),
      credit_limit: new Decimal('50000.00'),
    };
    prisma.$queryRaw.mockImplementationOnce(() => [overLimitCustomer]);
    prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: 'false' }); // Soft mode

    const res = await service.createSalesInvoice(
      {
        customerId: 'cust-1',
        warehouseId: 'wh-1',
        paymentMethod: 'CREDIT_ACCOUNT' as any,
        items: [
          {
            productId: 'prod-1',
            billedQuantity: 10,
            unitPrice: 50, // Total = 500
          },
        ],
      },
      'user-1',
    );

    expect(res).toBeDefined();
    expect((res as any).creditWarnings).toBeDefined();
    expect((res as any).creditWarnings?.[0]).toContain('exceeds customer credit limit');
  });

  it('hard blocks sale when ENFORCE_CREDIT_LIMIT is true and credit limit is exceeded', async () => {
    const overLimitCustomer = {
      ...mockCustomer,
      current_balance: new Decimal('49900.00'),
      credit_limit: new Decimal('50000.00'),
    };
    prisma.$queryRaw.mockImplementationOnce(() => [overLimitCustomer]);
    prisma.systemSetting.findUnique.mockImplementation(async ({ where }: any) => {
      if (where.organizationId_key.key === 'ENFORCE_CREDIT_LIMIT') {
        return { value: 'true' }; // Hard mode
      }
      return { value: 'TP' };
    });

    await expect(
      service.createSalesInvoice(
        {
          customerId: 'cust-1',
          warehouseId: 'wh-1',
          paymentMethod: 'CREDIT_ACCOUNT' as any,
          items: [
            {
              productId: 'prod-1',
              billedQuantity: 10,
              unitPrice: 50, // Total = 500
            },
          ],
        },
        'user-1',
      ),
    ).rejects.toThrow('Sale exceeds customer credit limit');
  });

  it('allows above-MRP line when user has sales.override_mrp permission with valid reason and logs audit', async () => {
    const res = await service.createSalesInvoice(
      {
        customerId: 'cust-1',
        warehouseId: 'wh-1',
        paymentMethod: 'CASH' as any,
        items: [
          {
            productId: 'prod-1',
            billedQuantity: 5,
            unitPrice: 65, // Exceeds MRP 55.00
            allowMrpOverride: true,
            mrpOverrideReason: 'Supervisor approved institutional tender markup',
          },
        ],
      },
      'user-1',
      ['sales.create', 'sales.override_mrp'],
    );

    expect(res).toBeDefined();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MRP_OVERRIDE_APPLIED',
        details: expect.objectContaining({
          overrides: expect.arrayContaining([
            expect.objectContaining({
              unitPrice: 65,
              retailPrice: 55,
              reason: 'Supervisor approved institutional tender markup',
            }),
          ]),
        }),
      }),
    );
  });

  it('rejects above-MRP line when user lacks sales.override_mrp permission', async () => {
    await expect(
      service.createSalesInvoice(
        {
          customerId: 'cust-1',
          warehouseId: 'wh-1',
          paymentMethod: 'CASH' as any,
          items: [
            {
              productId: 'prod-1',
              billedQuantity: 5,
              unitPrice: 65,
              allowMrpOverride: true,
              mrpOverrideReason: 'No permission user',
            },
          ],
        },
        'user-1',
        ['sales.create'], // lacks sales.override_mrp
      ),
    ).rejects.toThrow('You do not have permission (sales.override_mrp) to override Maximum Retail Price (MRP)');
  });

  it('preserves draft invoice when postDraftInvoice fails due to stock error', async () => {
    prisma.salesInvoice.findFirst.mockResolvedValueOnce({
      id: 'dft-err-1',
      status: 'DRAFT',
      customerId: 'cust-1',
      warehouseId: 'wh-1',
      paymentMethod: 'CASH',
      invoiceDate: new Date(),
      items: [
        {
          productId: 'prod-1',
          batchId: 'batch-1',
          batchNumber: 'BN-101',
          billedQuantity: 500, // Exceeds available stock (100)
          bonusQuantity: 0,
          unitPrice: new Decimal('48.00'),
          discountPercentage: new Decimal('0.00'),
          taxPercentage: new Decimal('0.00'),
          retailPrice: new Decimal('55.00'),
        },
      ],
      payments: [],
    });

    // Attempt to post draft with excessive quantity
    await expect(
      service.postDraftInvoice('dft-err-1', 'user-1'),
    ).rejects.toThrow();

    // Verify draft was NOT deleted because posting failed
    expect(prisma.salesInvoice.delete).not.toHaveBeenCalled();
  });

  describe('Delivery Address Validation and Snapshotting', () => {
    it('persists immutable address snapshot upon posting invoice', async () => {
      await service.createSalesInvoice(
        {
          customerId: 'cust-1',
          warehouseId: 'wh-1',
          deliveryAddressId: 'addr-1',
          paymentMethod: 'CASH' as any,
          items: [
            {
              productId: 'prod-1',
              batchId: 'batch-1',
              billedQuantity: 2,
              unitPrice: 48,
            },
          ],
        },
        'user-1',
      );

      expect(prisma.salesInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deliveryAddressId: 'addr-1',
            deliveryTitle: 'Main Branch Pharmacy',
            deliveryRecipient: 'Dr. Tariq',
            deliveryPhone: '03001234567',
            deliveryAddress: 'Shop 12, Main Market',
            deliveryCity: 'Karachi',
            deliveryInstructions: 'Deliver 10am-4pm',
          }),
        }),
      );
    });

    it('rejects posting with an inactive delivery address', async () => {
      await expect(
        service.createSalesInvoice(
          {
            customerId: 'cust-1',
            warehouseId: 'wh-1',
            deliveryAddressId: 'addr-inactive',
            paymentMethod: 'CASH' as any,
            items: [
              {
                productId: 'prod-1',
                batchId: 'batch-1',
                billedQuantity: 2,
                unitPrice: 48,
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow('Selected delivery address is inactive and cannot be used for new invoices.');
    });

    it('rejects posting with delivery address belonging to another customer', async () => {
      await expect(
        service.createSalesInvoice(
          {
            customerId: 'cust-1',
            warehouseId: 'wh-1',
            deliveryAddressId: 'addr-other-cust',
            paymentMethod: 'CASH' as any,
            items: [
              {
                productId: 'prod-1',
                batchId: 'batch-1',
                billedQuantity: 2,
                unitPrice: 48,
              },
            ],
          },
          'user-1',
        ),
      ).rejects.toThrow('Selected delivery address does not belong to the selected customer.');
    });

    it('persists address snapshot when creating draft invoice', async () => {
      await service.createSalesInvoice(
        {
          customerId: 'cust-1',
          warehouseId: 'wh-1',
          deliveryAddressId: 'addr-1',
          paymentMethod: 'CASH' as any,
          isDraft: true,
          items: [
            {
              productId: 'prod-1',
              batchId: 'batch-1',
              billedQuantity: 2,
              unitPrice: 48,
            },
          ],
        },
        'user-1',
      );

      expect(prisma.salesInvoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'DRAFT',
            deliveryAddressId: 'addr-1',
            deliveryTitle: 'Main Branch Pharmacy',
            deliveryAddress: 'Shop 12, Main Market',
          }),
        }),
      );
    });
  });

  describe('Sales Invoice Cancellation with Delivery Orders', () => {
    it('cancels sales invoice normally when no Delivery Order is linked', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';
        if (text.includes('FROM sales_invoices')) {
          return [{
            id: 'inv-1',
            status: 'POSTED',
            customer_id: 'cust-1',
            branch_id: 'branch-1',
            warehouse_id: 'wh-1',
            invoice_number: 'INV-00001',
            net_total: new Decimal('480.00'),
            paid_amount: new Decimal('480.00'),
            balance_amount: new Decimal('0.00'),
          }];
        }
        if (text.includes('FROM customers')) {
          return [mockCustomer];
        }
        if (text.includes('FROM delivery_orders')) {
          return []; // No linked DO
        }
        return [];
      });

      await service.cancelSalesInvoice(
        'inv-1',
        'user-1',
        { cancellationReason: 'Customer return request' },
      );

      expect(prisma.salesInvoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      expect(prisma.deliveryOrder.update).not.toHaveBeenCalled();
    });

    it('automatically cancels a READY Delivery Order when invoice is cancelled', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';
        if (text.includes('FROM sales_invoices')) {
          return [{
            id: 'inv-1',
            status: 'POSTED',
            customer_id: 'cust-1',
            branch_id: 'branch-1',
            warehouse_id: 'wh-1',
            invoice_number: 'INV-00001',
            net_total: new Decimal('480.00'),
            paid_amount: new Decimal('480.00'),
            balance_amount: new Decimal('0.00'),
          }];
        }
        if (text.includes('FROM customers')) {
          return [mockCustomer];
        }
        if (text.includes('FROM delivery_orders')) {
          return [{ id: 'do-1', do_number: 'DO-00001', status: 'READY' }];
        }
        return [];
      });

      await service.cancelSalesInvoice(
        'inv-1',
        'user-1',
        { cancellationReason: 'Customer return request' },
      );

      expect(prisma.deliveryOrder.update).toHaveBeenCalledWith({
        where: { id: 'do-1' },
        data: expect.objectContaining({
          status: 'CANCELLED',
          cancelledById: 'user-1',
        }),
      });
    });

    it('blocks invoice cancellation when Delivery Order is PARTIALLY_DELIVERED', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';
        if (text.includes('FROM sales_invoices')) {
          return [{
            id: 'inv-1',
            status: 'POSTED',
            customer_id: 'cust-1',
            branch_id: 'branch-1',
            warehouse_id: 'wh-1',
            invoice_number: 'INV-00001',
            net_total: new Decimal('480.00'),
            paid_amount: new Decimal('480.00'),
            balance_amount: new Decimal('0.00'),
          }];
        }
        if (text.includes('FROM customers')) {
          return [mockCustomer];
        }
        if (text.includes('FROM delivery_orders')) {
          return [{ id: 'do-1', do_number: 'DO-00001', status: 'PARTIALLY_DELIVERED' }];
        }
        return [];
      });

      await expect(
        service.cancelSalesInvoice(
          'inv-1',
          'user-1',
          { cancellationReason: 'Test' },
        ),
      ).rejects.toThrow('Cannot cancel sales invoice "INV-00001" because Delivery Order "DO-00001" has already been partially delivered. Please process a Sales Return instead.');
    });

    it('blocks invoice cancellation when Delivery Order is DELIVERED', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const text = typeof query === 'string' ? query : query?.strings?.join(' ') || '';
        if (text.includes('FROM sales_invoices')) {
          return [{
            id: 'inv-1',
            status: 'POSTED',
            customer_id: 'cust-1',
            branch_id: 'branch-1',
            warehouse_id: 'wh-1',
            invoice_number: 'INV-00001',
            net_total: new Decimal('480.00'),
            paid_amount: new Decimal('480.00'),
            balance_amount: new Decimal('0.00'),
          }];
        }
        if (text.includes('FROM customers')) {
          return [mockCustomer];
        }
        if (text.includes('FROM delivery_orders')) {
          return [{ id: 'do-1', do_number: 'DO-00001', status: 'DELIVERED' }];
        }
        return [];
      });

      await expect(
        service.cancelSalesInvoice(
          'inv-1',
          'user-1',
          { cancellationReason: 'Test' },
        ),
      ).rejects.toThrow('Cannot cancel sales invoice "INV-00001" because Delivery Order "DO-00001" has already been delivered. Please process a Sales Return instead.');
    });
  });
});


