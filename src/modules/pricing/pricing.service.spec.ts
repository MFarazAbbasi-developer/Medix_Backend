import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PricingService } from './pricing.service';
import { PricingEngineService } from './pricing-engine.service';
import { SchemeType, CustomerType } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';

describe('PricingService', () => {
  let service: PricingService;
  let pricingEngine: PricingEngineService;
  let prisma: any;
  let audit: any;

  const mockOrg = { id: 'org-001', name: 'Medix Pharma' };
  const mockCustomer = {
    id: 'cust-001',
    code: 'CUST-001',
    name: 'Al-Madina Medicos',
    customerType: CustomerType.RETAIL_PHARMACY,
    defaultDiscountPercentage: new Decimal('3.00'),
    isTaxExempt: false,
  };
  const mockProduct = {
    id: 'prod-001',
    sku: 'PAN-500',
    name: 'Panadol 500mg',
    genericName: 'Paracetamol',
    taxPercentage: new Decimal('0.00'),
    batches: [
      {
        id: 'batch-001',
        batchNumber: 'B-PAN-01',
        expiryDate: new Date('2028-01-01'),
        tradePrice: new Decimal('50.00'),
        retailPrice: new Decimal('60.00'),
        purchaseCost: new Decimal('40.00'),
      },
    ],
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      customer: {
        findFirst: vi.fn().mockResolvedValue(mockCustomer),
      },
      product: {
        findFirst: vi.fn().mockResolvedValue(mockProduct),
      },
      systemSetting: {
        findUnique: vi.fn().mockResolvedValue({ value: 'TP' }),
      },
      customerPricingRule: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
      promotionalScheme: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
      },
    };

    audit = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    pricingEngine = new PricingEngineService();
    service = new PricingService(prisma, audit, pricingEngine);
  });

  describe('Pricing Rule CRUD', () => {
    it('should create customer pricing rule with valid dates and audit log', async () => {
      prisma.customerPricingRule.create.mockResolvedValue({
        id: 'rule-new-1',
        organizationId: 'org-001',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: new Decimal('48.00'),
        isActive: true,
      });

      const res = await service.createPricingRule(
        {
          customerId: 'cust-001',
          productId: 'prod-001',
          customPrice: 48.0,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        },
        'user-admin',
      );

      expect(res.id).toBe('rule-new-1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_PRICING_RULE',
          entity: 'CUSTOMER_PRICING_RULE',
        }),
      );
    });

    it('should throw BadRequestException if end date is earlier than start date', async () => {
      await expect(
        service.createPricingRule({
          customerId: 'cust-001',
          productId: 'prod-001',
          customPrice: 48.0,
          startDate: '2026-12-31',
          endDate: '2026-01-01', // Invalid
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Promotional Scheme CRUD', () => {
    it('should create promotional scheme and record audit log', async () => {
      prisma.promotionalScheme.findUnique.mockResolvedValue(null);
      prisma.promotionalScheme.create.mockResolvedValue({
        id: 'sch-new-1',
        name: 'Panadol Buy 10 Get 1 Free',
        code: 'SCH-PAN-10P1',
        schemeType: SchemeType.BUY_X_GET_Y_FREE,
        productId: 'prod-001',
        minQuantity: 10,
        bonusQuantity: 1,
        isActive: true,
      });

      const res = await service.createScheme(
        {
          name: 'Panadol Buy 10 Get 1 Free',
          code: 'SCH-PAN-10P1',
          schemeType: SchemeType.BUY_X_GET_Y_FREE,
          productId: 'prod-001',
          minQuantity: 10,
          bonusQuantity: 1,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        },
        'user-admin',
      );

      expect(res.id).toBe('sch-new-1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_PROMOTIONAL_SCHEME',
          entity: 'PROMOTIONAL_SCHEME',
        }),
      );
    });

    it('should reject scheme creation if code is duplicate in organization', async () => {
      prisma.promotionalScheme.findUnique.mockResolvedValue({ id: 'existing-id' });

      await expect(
        service.createScheme({
          name: 'Duplicate Code Scheme',
          code: 'SCH-PAN-10P1',
          schemeType: SchemeType.BUY_X_GET_Y_FREE,
          productId: 'prod-001',
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Preview / Simulation Engine', () => {
    it('should return simulated pricing with candidate batches and applied scheme breakdown', async () => {
      prisma.customerPricingRule.findMany.mockResolvedValue([]);
      prisma.promotionalScheme.findMany.mockResolvedValue([
        {
          id: 'sch-001',
          name: 'Panadol Bulk 10+1',
          code: 'SCH-PAN-10P1',
          schemeType: SchemeType.BUY_X_GET_Y_FREE,
          productId: 'prod-001',
          minQuantity: 10,
          bonusQuantity: 1,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
          isActive: true,
        },
      ]);

      const res = await service.previewPricing({
        customerId: 'cust-001',
        productId: 'prod-001',
        quantity: 20,
      });

      expect(res.customer.id).toBe('cust-001');
      expect(res.product.id).toBe('prod-001');
      expect(res.resolution.pricingSource).toBe('PROMOTIONAL_SCHEME');
      expect(res.resolution.billedQuantity).toBe(20);
      expect(res.resolution.bonusQuantity).toBe(2);
      expect(res.resolution.totalQuantity).toBe(22);
      expect(res.resolution.grossTotal).toBe(1000.0); // 20 * 50
    });
  });
});
