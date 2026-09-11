import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeliveryOrdersService } from './delivery-orders.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('DeliveryOrdersService', () => {
  let service: DeliveryOrdersService;
  let prisma: any;
  let numberingService: any;
  let auditService: any;

  const mockCustomer = {
    id: 'cust-1',
    code: 'CUST-001',
    name: 'Al-Shifa Pharmacy',
    customerType: 'RETAIL_PHARMACY',
    phone: '03001234567',
  };

  const mockWalkInCustomer = {
    id: 'cust-walkin',
    code: 'CUST-WALKIN',
    name: 'Walk-In Customer',
    customerType: 'WALK_IN',
    phone: null,
  };

  const mockSalesman = {
    id: 'sm-1',
    code: 'SM-001',
    name: 'Ahmed Khan',
  };

  const mockRoute = {
    id: 'rt-1',
    code: 'RT-001',
    name: 'Saddar Route',
  };

  const mockPostedInvoice = {
    id: 'inv-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    warehouseId: 'wh-1',
    customerId: 'cust-1',
    invoiceNumber: 'INV-00010',
    invoiceDate: new Date('2026-09-12'),
    status: 'POSTED',
    deliveryAddressId: 'addr-1',
    deliveryTitle: 'Main Pharmacy Clifton',
    deliveryRecipient: 'Dr. Tariq',
    deliveryPhone: '03001234567',
    deliveryAddress: 'Shop 12, Block 5, Clifton',
    deliveryCity: 'Karachi',
    deliveryInstructions: 'Deliver before 5 PM',
    salesmanId: 'sm-1',
    routeId: 'rt-1',
    customer: mockCustomer,
    salesman: mockSalesman,
    route: mockRoute,
    items: [
      {
        id: 'inv-item-1',
        productId: 'prod-1',
        batchId: 'batch-1',
        batchNumber: 'BN-101',
        expiryDate: new Date('2027-12-31'),
        billedQuantity: 100,
        bonusQuantity: 10,
        totalQuantity: 110,
        product: {
          id: 'prod-1',
          name: 'Panadol Extra 500mg',
          sku: 'SKU-PAN-500',
          genericName: 'Paracetamol',
          packSize: '10x10',
          unit: { symbol: 'Tab', name: 'Tablet' },
        },
        batch: {
          id: 'batch-1',
          batchNumber: 'BN-101',
          expiryDate: new Date('2027-12-31'),
        },
      },
    ],
    deliveryOrder: null,
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Medix Pharma' }),
      },
      salesInvoice: {
        findFirst: vi.fn().mockImplementation(({ where }) => {
          if (where.id === 'inv-1') return Promise.resolve(mockPostedInvoice);
          if (where.id === 'inv-draft') return Promise.resolve({ ...mockPostedInvoice, id: 'inv-draft', status: 'DRAFT' });
          if (where.id === 'inv-cancelled') return Promise.resolve({ ...mockPostedInvoice, id: 'inv-cancelled', status: 'CANCELLED' });
          if (where.id === 'inv-walkin') return Promise.resolve({ ...mockPostedInvoice, id: 'inv-walkin', customer: mockWalkInCustomer });
          if (where.id === 'inv-no-addr') return Promise.resolve({ ...mockPostedInvoice, id: 'inv-no-addr', deliveryAddress: null, deliveryTitle: null });
          if (where.id === 'inv-has-do') return Promise.resolve({ ...mockPostedInvoice, id: 'inv-has-do', deliveryOrder: { id: 'do-1', doNumber: 'DO-00001' } });
          return Promise.resolve(null);
        }),
        findMany: vi.fn().mockResolvedValue([mockPostedInvoice]),
      },
      deliveryOrder: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'do-1',
          ...data,
          status: 'READY',
          createdAt: new Date(),
        })),
        update: vi.fn().mockImplementation(({ where, data }) => Promise.resolve({
          id: where.id,
          ...data,
        })),
      },
      deliveryOrderItem: {
        findMany: vi.fn(),
        update: vi.fn(),
      },
      deliveryFulfillment: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockImplementation(({ data }) => Promise.resolve({
          id: 'ful-1',
          ...data,
          createdAt: new Date(),
        })),
      },
      stockMovement: {
        create: vi.fn(),
      },
      customerLedgerEntry: {
        create: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => callback(prisma)),
      $queryRaw: vi.fn(),
    };

    numberingService = {
      generateNextNumber: vi.fn().mockResolvedValue({
        documentNumber: 'DO-00001',
        seriesId: 'series-1',
        sequence: 1,
      }),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(true),
    };

    service = new DeliveryOrdersService(prisma, numberingService, auditService);
  });

  describe('createDeliveryOrder', () => {
    it('creates a DeliveryOrder with status READY from a POSTED invoice with frozen snapshots', async () => {
      const result = await service.createDeliveryOrder(
        { salesInvoiceId: 'inv-1', notes: 'Urgent clinic dispatch' },
        'user-1',
      );

      expect(numberingService.generateNextNumber).toHaveBeenCalledWith(
        'DELIVERY_ORDER',
        'branch-1',
      );
      expect(prisma.deliveryOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            doNumber: 'DO-00001',
            status: 'READY',
            salesInvoiceId: 'inv-1',
            invoiceNumber: 'INV-00010',
            customerName: 'Al-Shifa Pharmacy',
            deliveryRecipient: 'Dr. Tariq',
            deliveryAddress: 'Shop 12, Block 5, Clifton',
            deliveryCity: 'Karachi',
            salesmanName: 'Ahmed Khan',
            routeName: 'Saddar Route',
            notes: 'Urgent clinic dispatch',
            items: {
              create: [
                expect.objectContaining({
                  salesInvoiceItemId: 'inv-item-1',
                  productName: 'Panadol Extra 500mg',
                  productSku: 'SKU-PAN-500',
                  unitOfMeasurement: 'Tab',
                  orderedBilledQuantity: 100,
                  orderedBonusQuantity: 10,
                  deliveredBilledQuantity: 0,
                  deliveredBonusQuantity: 0,
                }),
              ],
            },
          }),
        }),
      );

      // Verify Stock and Ledger invariant: Zero movements or entries!
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE_DELIVERY_ORDER' }),
      );
    });

    it('rejects creating DO for DRAFT invoice', async () => {
      await expect(
        service.createDeliveryOrder({ salesInvoiceId: 'inv-draft' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects creating DO for CANCELLED invoice', async () => {
      await expect(
        service.createDeliveryOrder({ salesInvoiceId: 'inv-cancelled' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects creating DO for WALK_IN customer invoice', async () => {
      await expect(
        service.createDeliveryOrder({ salesInvoiceId: 'inv-walkin' }),
      ).rejects.toThrow('Walk-in customer counter invoices cannot create Delivery Orders.');
    });

    it('rejects creating DO for invoice without delivery address snapshot', async () => {
      await expect(
        service.createDeliveryOrder({ salesInvoiceId: 'inv-no-addr' }),
      ).rejects.toThrow('Sales invoice does not have a valid delivery destination snapshot');
    });

    it('rejects creating DO when one already exists for the invoice (1-to-1 cardinality)', async () => {
      await expect(
        service.createDeliveryOrder({ salesInvoiceId: 'inv-has-do' }),
      ).rejects.toThrow('A Delivery Order ("DO-00001") already exists for this sales invoice');
    });
  });

  describe('recordFulfillment', () => {
    it('records partial fulfillment and transitions status to PARTIALLY_DELIVERED', async () => {
      // Mock locked DO and Items
      prisma.$queryRaw.mockImplementation((query: any) => {
        const sql = query?.strings?.join('') || '';
        if (sql.includes('FROM delivery_orders')) {
          return Promise.resolve([
            {
              id: 'do-1',
              organization_id: 'org-1',
              branch_id: 'branch-1',
              status: 'READY',
              do_number: 'DO-00001',
              invoice_number: 'INV-00010',
            },
          ]);
        }
        if (sql.includes('FROM delivery_order_items')) {
          return Promise.resolve([
            {
              id: 'do-item-1',
              delivery_order_id: 'do-1',
              product_name: 'Panadol Extra 500mg',
              ordered_billed_quantity: 100,
              ordered_bonus_quantity: 10,
              delivered_billed_quantity: 0,
              delivered_bonus_quantity: 0,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      prisma.deliveryOrderItem.findMany.mockResolvedValue([
        {
          id: 'do-item-1',
          deliveryOrderId: 'do-1',
          orderedBilledQuantity: 100,
          orderedBonusQuantity: 10,
          deliveredBilledQuantity: 60,
          deliveredBonusQuantity: 6,
        },
      ]);

      await service.recordFulfillment(
        'do-1',
        {
          items: [
            {
              deliveryOrderItemId: 'do-item-1',
              billedQuantity: 60,
              bonusQuantity: 6,
            },
          ],
          notes: 'Partial dispatch batch 1',
        },
        'user-1',
      );

      // Verify DeliveryFulfillment record created with event #1
      expect(prisma.deliveryFulfillment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          deliveryOrderId: 'do-1',
          fulfillmentNumber: 1,
          notes: 'Partial dispatch batch 1',
          items: {
            create: [
              {
                deliveryOrderItemId: 'do-item-1',
                deliveredBilledQuantity: 60,
                deliveredBonusQuantity: 6,
              },
            ],
          },
        }),
      });

      // Verify DeliveryOrderItem delivered quantities incremented
      expect(prisma.deliveryOrderItem.update).toHaveBeenCalledWith({
        where: { id: 'do-item-1' },
        data: {
          deliveredBilledQuantity: { increment: 60 },
          deliveredBonusQuantity: { increment: 6 },
        },
      });

      // Verify status set to PARTIALLY_DELIVERED
      expect(prisma.deliveryOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'do-1' },
          data: { status: 'PARTIALLY_DELIVERED' },
        }),
      );

      // Invariant: Zero stock or ledger impacts
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('transitions status to DELIVERED when full quantities are fulfilled', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const sql = query?.strings?.join('') || '';
        if (sql.includes('FROM delivery_orders')) {
          return Promise.resolve([
            {
              id: 'do-1',
              organization_id: 'org-1',
              status: 'PARTIALLY_DELIVERED',
              do_number: 'DO-00001',
            },
          ]);
        }
        if (sql.includes('FROM delivery_order_items')) {
          return Promise.resolve([
            {
              id: 'do-item-1',
              delivery_order_id: 'do-1',
              product_name: 'Panadol Extra 500mg',
              ordered_billed_quantity: 100,
              ordered_bonus_quantity: 10,
              delivered_billed_quantity: 60,
              delivered_bonus_quantity: 6,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // All remaining fulfilled (40 billed + 4 bonus)
      prisma.deliveryOrderItem.findMany.mockResolvedValue([
        {
          id: 'do-item-1',
          deliveryOrderId: 'do-1',
          orderedBilledQuantity: 100,
          orderedBonusQuantity: 10,
          deliveredBilledQuantity: 100,
          deliveredBonusQuantity: 10,
        },
      ]);

      await service.recordFulfillment(
        'do-1',
        {
          items: [
            {
              deliveryOrderItemId: 'do-item-1',
              billedQuantity: 40,
              bonusQuantity: 4,
            },
          ],
        },
        'user-1',
      );

      expect(prisma.deliveryOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'do-1' },
          data: { status: 'DELIVERED' },
        }),
      );
    });

    it('rejects over-delivery beyond pending quantity', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const sql = query?.strings?.join('') || '';
        if (sql.includes('FROM delivery_orders')) {
          return Promise.resolve([
            {
              id: 'do-1',
              organization_id: 'org-1',
              status: 'READY',
              do_number: 'DO-00001',
            },
          ]);
        }
        if (sql.includes('FROM delivery_order_items')) {
          return Promise.resolve([
            {
              id: 'do-item-1',
              delivery_order_id: 'do-1',
              product_name: 'Panadol Extra 500mg',
              ordered_billed_quantity: 100,
              ordered_bonus_quantity: 10,
              delivered_billed_quantity: 0,
              delivered_bonus_quantity: 0,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      await expect(
        service.recordFulfillment('do-1', {
          items: [{ deliveryOrderItemId: 'do-item-1', billedQuantity: 150, bonusQuantity: 0 }],
        }),
      ).rejects.toThrow('Delivered billed quantity (150) exceeds pending billed quantity (100)');
    });

    it('rejects negative or zero fulfillment quantities', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const sql = query?.strings?.join('') || '';
        if (sql.includes('FROM delivery_orders')) {
          return Promise.resolve([{ id: 'do-1', organization_id: 'org-1', status: 'READY' }]);
        }
        if (sql.includes('FROM delivery_order_items')) {
          return Promise.resolve([
            {
              id: 'do-item-1',
              delivery_order_id: 'do-1',
              product_name: 'Panadol',
              ordered_billed_quantity: 100,
              ordered_bonus_quantity: 10,
              delivered_billed_quantity: 0,
              delivered_bonus_quantity: 0,
            },
          ]);
        }
        return Promise.resolve([]);
      });

      await expect(
        service.recordFulfillment('do-1', {
          items: [{ deliveryOrderItemId: 'do-item-1', billedQuantity: -5, bonusQuantity: 0 }],
        }),
      ).rejects.toThrow('Fulfillment quantities cannot be negative.');

      await expect(
        service.recordFulfillment('do-1', {
          items: [{ deliveryOrderItemId: 'do-item-1', billedQuantity: 0, bonusQuantity: 0 }],
        }),
      ).rejects.toThrow('Total fulfillment quantity must be greater than zero.');
    });

    it('rejects fulfillment of a CANCELLED DeliveryOrder', async () => {
      prisma.$queryRaw.mockImplementation((query: any) => {
        const sql = query?.strings?.join('') || '';
        if (sql.includes('FROM delivery_orders')) {
          return Promise.resolve([{ id: 'do-1', organization_id: 'org-1', status: 'CANCELLED' }]);
        }
        return Promise.resolve([]);
      });

      await expect(
        service.recordFulfillment('do-1', {
          items: [{ deliveryOrderItemId: 'do-item-1', billedQuantity: 10, bonusQuantity: 0 }],
        }),
      ).rejects.toThrow('Cannot record fulfillment for a cancelled Delivery Order.');
    });
  });

  describe('cancelDeliveryOrder', () => {
    it('cancels a READY DeliveryOrder with reason', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'do-1',
          organization_id: 'org-1',
          status: 'READY',
          do_number: 'DO-00001',
        },
      ]);

      await service.cancelDeliveryOrder(
        'do-1',
        { cancellationReason: 'Customer requested cancellation' },
        'user-1',
      );

      expect(prisma.deliveryOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'do-1' },
          data: expect.objectContaining({
            status: 'CANCELLED',
            cancelledById: 'user-1',
            cancellationReason: 'Customer requested cancellation',
          }),
        }),
      );

      // Invariant: Zero stock or ledger changes
      expect(prisma.stockMovement.create).not.toHaveBeenCalled();
      expect(prisma.customerLedgerEntry.create).not.toHaveBeenCalled();
    });

    it('rejects cancellation of a PARTIALLY_DELIVERED DeliveryOrder', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          id: 'do-1',
          organization_id: 'org-1',
          status: 'PARTIALLY_DELIVERED',
          do_number: 'DO-00001',
        },
      ]);

      await expect(
        service.cancelDeliveryOrder('do-1', { cancellationReason: 'Cannot deliver' }),
      ).rejects.toThrow('Only READY Delivery Orders with zero fulfillment can be cancelled');
    });
  });

  describe('getEligibleInvoices', () => {
    it('filters for POSTED non-WALK_IN invoices with delivery destination and no existing DO', async () => {
      await service.getEligibleInvoices('INV-00010');

      expect(prisma.salesInvoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'POSTED',
            customer: { customerType: { not: 'WALK_IN' } },
            deliveryAddress: { not: null },
            deliveryOrder: { is: null },
          }),
        }),
      );
    });
  });
});
