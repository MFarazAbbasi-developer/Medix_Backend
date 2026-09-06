import { describe, it, expect, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PricingEngineService } from './pricing-engine.service';
import { CustomerType, SchemeType } from '@prisma/client';

describe('PricingEngineService', () => {
  let service: PricingEngineService;

  const mockProduct: any = {
    id: 'prod-001',
    sku: 'AUG-625',
    name: 'Augmentin 625mg',
    genericName: 'Co-Amoxiclav',
    taxPercentage: 0,
  };

  const mockBatch: any = {
    id: 'batch-001',
    productId: 'prod-001',
    batchNumber: 'B-2026-01',
    expiryDate: new Date('2027-12-31'),
    purchaseCost: 180.0,
    tradePrice: 220.0,
    retailPrice: 250.0,
  };

  const mockCustomer: any = {
    id: 'cust-001',
    code: 'CUST-001',
    name: 'Al-Shifa Pharmacy',
    customerType: CustomerType.RETAIL_PHARMACY,
    defaultDiscountPercentage: 5.0,
    isTaxExempt: false,
  };

  beforeEach(() => {
    service = new PricingEngineService();
  });

  describe('1. Default Standard Pricing (TP / MRP)', () => {
    it('should calculate default trade price (TP) when no rules or schemes exist', () => {
      const custWithoutDiscount = { ...mockCustomer, defaultDiscountPercentage: 0 };
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: custWithoutDiscount,
        quantity: 10,
        defaultPricingBase: 'TP',
      });

      expect(res.pricingSource).toBe('DEFAULT_PRICE');
      expect(res.baseUnitPrice).toBe(220.0);
      expect(res.discountPercentage).toBe(0);
      expect(res.effectiveUnitPrice).toBe(220.0);
      expect(res.grossTotal).toBe(2200.0);
      expect(res.netLineTotal).toBe(2200.0);
      expect(res.bonusQuantity).toBe(0);
      expect(res.totalQuantity).toBe(10);
    });

    it('should calculate MRP when defaultPricingBase is MRP', () => {
      const custWithoutDiscount = { ...mockCustomer, defaultDiscountPercentage: 0 };
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: custWithoutDiscount,
        quantity: 10,
        defaultPricingBase: 'MRP',
      });

      expect(res.baseUnitPrice).toBe(250.0);
      expect(res.effectiveUnitPrice).toBe(250.0);
      expect(res.grossTotal).toBe(2500.0);
    });
  });

  describe('2. Customer-Specific Price & Discount Rules', () => {
    it('should apply custom contracted unit price (Priority 1)', () => {
      const pricingRule: any = {
        id: 'rule-001',
        organizationId: 'org-1',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: 205.0,
        discountPercentage: null,
        minQuantity: 1,
        isActive: true,
      };

      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer,
        quantity: 10,
        pricingRules: [pricingRule],
      });

      expect(res.pricingSource).toBe('CUSTOMER_CUSTOM_PRICE');
      expect(res.pricingRuleId).toBe('rule-001');
      expect(res.baseUnitPrice).toBe(205.0);
      expect(res.effectiveUnitPrice).toBe(205.0);
      expect(res.grossTotal).toBe(2050.0);
    });

    it('should apply customer-specific discount percentage (Priority 2)', () => {
      const discountRule: any = {
        id: 'rule-002',
        organizationId: 'org-1',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: null,
        discountPercentage: 12.0,
        minQuantity: 1,
        isActive: true,
      };

      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer,
        quantity: 10,
        pricingRules: [discountRule],
      });

      expect(res.pricingSource).toBe('CUSTOMER_PRODUCT_DISCOUNT');
      expect(res.pricingRuleId).toBe('rule-002');
      expect(res.baseUnitPrice).toBe(220.0);
      expect(res.discountPercentage).toBe(12.0);
      expect(res.discountAmount).toBe(264.0); // 220 * 10 * 12% = 264
      expect(res.netLineTotal).toBe(1936.0); // 2200 - 264 = 1936
      expect(res.effectiveUnitPrice).toBe(193.6);
    });

    it('should fallback to customer default discount if no custom rule applies (Priority 4)', () => {
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer, // has 5% defaultDiscountPercentage
        quantity: 10,
      });

      expect(res.pricingSource).toBe('CUSTOMER_DEFAULT_DISCOUNT');
      expect(res.discountPercentage).toBe(5.0);
      expect(res.discountAmount).toBe(110.0); // 2200 * 5% = 110
      expect(res.netLineTotal).toBe(2090.0);
    });
  });

  describe('3. Promotional Schemes & Bonus Quantities', () => {
    it('should calculate Buy 10 Get 1 Free commercial bonus scheme correctly', () => {
      const scheme: any = {
        id: 'sch-001',
        name: 'Buy 10 Get 1 Free Monsoon Special',
        code: 'SCH-AUG-10P1',
        schemeType: SchemeType.BUY_X_GET_Y_FREE,
        productId: 'prod-001',
        minQuantity: 10,
        bonusQuantity: 1,
        bonusProductId: 'prod-001',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isActive: true,
      };

      // Order 25 units: 2 multiples of 10 => 2 free bonus units
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: { ...mockCustomer, defaultDiscountPercentage: 0 },
        quantity: 25,
        promotionalSchemes: [scheme],
      });

      expect(res.pricingSource).toBe('PROMOTIONAL_SCHEME');
      expect(res.schemeId).toBe('sch-001');
      expect(res.billedQuantity).toBe(25);
      expect(res.bonusQuantity).toBe(2);
      expect(res.totalQuantity).toBe(27); // 25 billed + 2 bonus for stock deduction
      expect(res.grossTotal).toBe(5500.0); // 25 * 220 (Bonus stock produces 0 revenue)
      expect(res.netLineTotal).toBe(5500.0);
    });

    it('should apply scheme discount when schemeType is BUY_X_GET_DISCOUNT', () => {
      const scheme: any = {
        id: 'sch-002',
        name: 'Bulk Purchase 20+ units get 15% off',
        code: 'SCH-BULK-15',
        schemeType: SchemeType.BUY_X_GET_DISCOUNT,
        productId: 'prod-001',
        minQuantity: 20,
        discountPercentage: 15.0,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isActive: true,
      };

      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer,
        quantity: 20,
        promotionalSchemes: [scheme],
      });

      expect(res.pricingSource).toBe('PROMOTIONAL_SCHEME');
      expect(res.discountPercentage).toBe(15.0);
      expect(res.grossTotal).toBe(4400.0);
      expect(res.discountAmount).toBe(660.0);
      expect(res.netLineTotal).toBe(3740.0);
    });

    it('should ignore scheme if quantity is below minQuantity', () => {
      const scheme: any = {
        id: 'sch-001',
        name: 'Buy 10 Get 1 Free',
        code: 'SCH-10P1',
        schemeType: SchemeType.BUY_X_GET_Y_FREE,
        productId: 'prod-001',
        minQuantity: 10,
        bonusQuantity: 1,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isActive: true,
      };

      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: { ...mockCustomer, defaultDiscountPercentage: 0 },
        quantity: 9, // Below 10
        promotionalSchemes: [scheme],
      });

      expect(res.pricingSource).toBe('DEFAULT_PRICE');
      expect(res.bonusQuantity).toBe(0);
    });

    it('should respect customer eligibility on scheme', () => {
      const hospitalOnlyScheme: any = {
        id: 'sch-hosp',
        name: 'Hospital Institutional 20% discount',
        code: 'SCH-HOSP-20',
        schemeType: SchemeType.FLAT_DISCOUNT_PERCENT,
        productId: 'prod-001',
        minQuantity: 1,
        discountPercentage: 20.0,
        customerType: CustomerType.HOSPITAL, // Only hospitals
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isActive: true,
      };

      // Retail pharmacy customer
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer, // RETAIL_PHARMACY
        quantity: 10,
        promotionalSchemes: [hospitalOnlyScheme],
      });

      // Scheme does not apply to retail pharmacy; falls back to customer default 5%
      expect(res.pricingSource).toBe('CUSTOMER_DEFAULT_DISCOUNT');
      expect(res.discountPercentage).toBe(5.0);
    });
  });

  describe('4. Effective Date and Status Invariants', () => {
    it('should not apply expired pricing rules or schemes', () => {
      const expiredRule: any = {
        id: 'rule-exp',
        organizationId: 'org-1',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: 190.0,
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-12-31'), // Expired
        isActive: true,
      };

      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: { ...mockCustomer, defaultDiscountPercentage: 0 },
        quantity: 10,
        pricingRules: [expiredRule],
        asOfDate: new Date('2026-09-01'),
      });

      expect(res.pricingSource).toBe('DEFAULT_PRICE');
      expect(res.baseUnitPrice).toBe(220.0);
    });

    it('should not apply deactivated pricing rules or schemes', () => {
      const inactiveRule: any = {
        id: 'rule-inact',
        organizationId: 'org-1',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: 190.0,
        isActive: false, // Deactivated
      };

      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: { ...mockCustomer, defaultDiscountPercentage: 0 },
        quantity: 10,
        pricingRules: [inactiveRule],
      });

      expect(res.pricingSource).toBe('DEFAULT_PRICE');
    });
  });

  describe('5. Pricing Precedence & Non-Stacking Hierarchy', () => {
    it('should follow strict precedence without stacking discounts', () => {
      const customPriceRule: any = {
        id: 'rule-001',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: 200.0,
        isActive: true,
      };

      const discountRule: any = {
        id: 'rule-002',
        customerId: 'cust-001',
        productId: 'prod-001',
        discountPercentage: 10.0,
        isActive: true,
      };

      const scheme: any = {
        id: 'sch-001',
        schemeType: SchemeType.FLAT_DISCOUNT_PERCENT,
        productId: 'prod-001',
        discountPercentage: 15.0,
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isActive: true,
      };

      // Custom Contract Price overrides discount rule, scheme, and customer default discount
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer,
        quantity: 10,
        pricingRules: [customPriceRule, discountRule],
        promotionalSchemes: [scheme],
      });

      expect(res.pricingSource).toBe('CUSTOMER_CUSTOM_PRICE');
      expect(res.baseUnitPrice).toBe(200.0);
      expect(res.discountPercentage).toBe(0); // Non-stacking
      expect(res.effectiveUnitPrice).toBe(200.0);
    });

    it('should allow manual discount override by authorized user', () => {
      const res = service.resolvePricing({
        product: mockProduct,
        batch: mockBatch,
        customer: mockCustomer,
        quantity: 10,
        manualDiscountPercentage: 8.0,
      });

      expect(res.pricingSource).toBe('MANUAL_OVERRIDE');
      expect(res.discountPercentage).toBe(8.0);
      expect(res.discountAmount).toBe(176.0); // 2200 * 8% = 176
    });
  });

  describe('6. MRP Ceiling Constraint', () => {
    it('should reject prices that exceed retail price (MRP ceiling)', () => {
      const invalidCustomRule: any = {
        id: 'rule-invalid',
        customerId: 'cust-001',
        productId: 'prod-001',
        customPrice: 300.0, // MRP is 250.0
        isActive: true,
      };

      expect(() =>
        service.resolvePricing({
          product: mockProduct,
          batch: mockBatch, // retailPrice = 250.0
          customer: mockCustomer,
          quantity: 10,
          pricingRules: [invalidCustomRule],
        }),
      ).toThrow(BadRequestException);
    });
  });
});
