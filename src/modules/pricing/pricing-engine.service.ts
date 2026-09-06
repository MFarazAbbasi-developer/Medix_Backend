import { Injectable, BadRequestException } from '@nestjs/common';
import { Customer, Product, Batch, CustomerPricingRule, PromotionalScheme, SchemeType } from '@prisma/client';

export type PricingSource =
  | 'CUSTOMER_CUSTOM_PRICE'
  | 'CUSTOMER_PRODUCT_DISCOUNT'
  | 'PROMOTIONAL_SCHEME'
  | 'CUSTOMER_DEFAULT_DISCOUNT'
  | 'DEFAULT_PRICE'
  | 'MANUAL_OVERRIDE';

export interface ResolvePricingParams {
  product: Product;
  batch?: Batch | null;
  customer: Customer;
  quantity: number;
  pricingRules?: CustomerPricingRule[];
  promotionalSchemes?: PromotionalScheme[];
  defaultPricingBase?: 'TP' | 'MRP';
  manualUnitPrice?: number | null;
  manualDiscountPercentage?: number | null;
  manualTaxPercentage?: number | null;
  asOfDate?: Date;
  allowMrpOverride?: boolean;
  mrpOverrideReason?: string;
}

export interface PricingResolutionResult {
  productId: string;
  batchId?: string | null;
  billedQuantity: number;
  bonusQuantity: number;
  bonusProductId?: string | null;
  totalQuantity: number;
  tradePrice: number;
  retailPrice: number;
  unitCost: number;
  baseUnitPrice: number;
  customPrice?: number | null;
  discountPercentage: number;
  discountAmount: number;
  effectiveUnitPrice: number;
  grossTotal: number;
  netLineTotal: number;
  taxPercentage: number;
  taxAmount: number;
  finalTotalWithTax: number;
  pricingSource: PricingSource;
  pricingRuleId?: string | null;
  schemeId?: string | null;
  schemeName?: string | null;
  reason: string;
  mrpOverridden?: boolean;
  mrpOverrideReason?: string | null;
}

@Injectable()
export class PricingEngineService {
  /**
   * Evaluates pricing for a product/batch + customer + quantity with strict pharma precedence:
   * 1. Explicit Customer Contract Price (CustomerPricingRule.customPrice)
   * 2. Customer Product Discount Rule (CustomerPricingRule.discountPercentage)
   * 3. Promotional Scheme (Buy X Get Y Free / Promo Discount / Promo Price)
   * 4. Customer Default Discount (Customer.defaultDiscountPercentage)
   * 5. Product / Batch Default Price (TP or MRP)
   * (Manual overrides at invoice level take precedence if provided by authorized user)
   */
  resolvePricing(params: ResolvePricingParams): PricingResolutionResult {
    const {
      product,
      batch,
      customer,
      quantity,
      pricingRules = [],
      promotionalSchemes = [],
      defaultPricingBase = 'TP',
      manualUnitPrice,
      manualDiscountPercentage,
      manualTaxPercentage,
      asOfDate = new Date(),
    } = params;

    if (quantity <= 0) {
      throw new BadRequestException('Billed quantity must be greater than zero');
    }

    const tradePrice = batch ? Number(batch.tradePrice) : 0;
    const retailPrice = batch ? Number(batch.retailPrice) : 0;
    const unitCost = batch ? Number(batch.purchaseCost) : 0;

    const standardBasePrice = defaultPricingBase === 'MRP' ? retailPrice : tradePrice;

    let baseUnitPrice = standardBasePrice;
    let discountPercentage = 0;
    let bonusQuantity = 0;
    let bonusProductId: string | null = null;
    let pricingSource: PricingSource = 'DEFAULT_PRICE';
    let pricingRuleId: string | null = null;
    let schemeId: string | null = null;
    let schemeName: string | null = null;
    let reason = `Applied default standard pricing base (${defaultPricingBase})`;

    // Check manual override first if provided
    const hasManualPrice = manualUnitPrice !== undefined && manualUnitPrice !== null;
    const hasManualDiscount = manualDiscountPercentage !== undefined && manualDiscountPercentage !== null;

    if (hasManualPrice) {
      baseUnitPrice = Number(manualUnitPrice);
      pricingSource = 'MANUAL_OVERRIDE';
      reason = 'Manual unit price override applied';
    }

    // Step 1 & 2: Evaluate Customer Pricing Rules
    const activeRules = pricingRules.filter((rule) => {
      if (!rule.isActive) return false;
      if (rule.productId !== product.id) return false;
      if (rule.customerId !== customer.id) return false;
      if (rule.minQuantity && quantity < rule.minQuantity) return false;
      if (rule.startDate && new Date(rule.startDate) > asOfDate) return false;
      if (rule.endDate && new Date(rule.endDate) < asOfDate) return false;
      return true;
    });

    // Rule with custom contracted price (Priority 1)
    const customPriceRule = activeRules.find(
      (r) => r.customPrice !== null && r.customPrice !== undefined,
    );

    // Rule with custom discount % (Priority 2)
    const customDiscountRule = activeRules.find(
      (r) => r.discountPercentage !== null && r.discountPercentage !== undefined,
    );

    // Step 3: Evaluate Promotional Schemes (Priority 3)
    const activeSchemes = promotionalSchemes.filter((s) => {
      if (!s.isActive) return false;
      if (s.productId !== product.id) return false;
      if (s.startDate && new Date(s.startDate) > asOfDate) return false;
      if (s.endDate && new Date(s.endDate) < asOfDate) return false;
      if (s.customerId && s.customerId !== customer.id) return false;
      if (s.customerType && s.customerType !== customer.customerType) return false;
      if (quantity < (s.minQuantity || 1)) return false;
      return true;
    });

    // Sort schemes to pick highest benefit / priority (most specific customer rule first, then largest minQuantity)
    activeSchemes.sort((a, b) => {
      if (a.customerId && !b.customerId) return -1;
      if (!a.customerId && b.customerId) return 1;
      return (b.minQuantity || 0) - (a.minQuantity || 0);
    });

    const matchingScheme = activeSchemes[0] || null;

    // Apply Precedence Hierarchy (Non-Stacking):
    if (!hasManualPrice && customPriceRule) {
      // Priority 1: Customer Contract Price
      baseUnitPrice = Number(customPriceRule.customPrice);
      pricingSource = 'CUSTOMER_CUSTOM_PRICE';
      pricingRuleId = customPriceRule.id;
      reason = `Contracted customer fixed price (Rs.${baseUnitPrice.toFixed(2)}) applied`;

      if (customPriceRule.discountPercentage) {
        discountPercentage = Number(customPriceRule.discountPercentage);
      }
    } else if (customDiscountRule && !hasManualDiscount) {
      // Priority 2: Customer Product Discount Rule
      discountPercentage = Number(customDiscountRule.discountPercentage);
      pricingSource = 'CUSTOMER_PRODUCT_DISCOUNT';
      pricingRuleId = customDiscountRule.id;
      reason = `Customer-specific product discount (${discountPercentage}%) applied`;
    } else if (matchingScheme) {
      // Priority 3: Promotional Scheme
      schemeId = matchingScheme.id;
      schemeName = matchingScheme.name;

      switch (matchingScheme.schemeType) {
        case SchemeType.BUY_X_GET_Y_FREE: {
          const minQty = matchingScheme.minQuantity || 1;
          const freeQty = matchingScheme.bonusQuantity || 0;
          const multipliers = Math.floor(quantity / minQty);
          bonusQuantity = multipliers * freeQty;
          bonusProductId = matchingScheme.bonusProductId || product.id;
          pricingSource = 'PROMOTIONAL_SCHEME';
          reason = `Promotional scheme "${matchingScheme.name}" applied: Buy ${minQty}, Get ${freeQty} Free (Earned ${bonusQuantity} bonus units)`;
          break;
        }
        case SchemeType.BUY_X_GET_DISCOUNT:
        case SchemeType.FLAT_DISCOUNT_PERCENT: {
          if (!hasManualDiscount && matchingScheme.discountPercentage) {
            discountPercentage = Number(matchingScheme.discountPercentage);
            pricingSource = 'PROMOTIONAL_SCHEME';
            reason = `Promotional scheme "${matchingScheme.name}" applied: ${discountPercentage}% discount`;
          }
          break;
        }
        case SchemeType.FLAT_PRICE_OVERRIDE: {
          if (!hasManualPrice && matchingScheme.overridePrice) {
            baseUnitPrice = Number(matchingScheme.overridePrice);
            pricingSource = 'PROMOTIONAL_SCHEME';
            reason = `Promotional scheme "${matchingScheme.name}" promo price (Rs.${baseUnitPrice.toFixed(2)}) applied`;
          }
          break;
        }
      }
    } else if (
      !hasManualDiscount &&
      (customer.defaultDiscountPercentage || (customer as any).default_discount_percentage)
    ) {
      // Priority 4: Customer Default Discount
      const defaultDisc = Number(
        customer.defaultDiscountPercentage || (customer as any).default_discount_percentage,
      );
      if (defaultDisc > 0) {
        discountPercentage = defaultDisc;
        pricingSource = 'CUSTOMER_DEFAULT_DISCOUNT';
        reason = `Customer default trade discount (${discountPercentage}%) applied`;
      }
    }

    // Manual discount override takes precedence if supplied
    if (hasManualDiscount) {
      discountPercentage = Number(manualDiscountPercentage);
      if (pricingSource !== 'MANUAL_OVERRIDE') {
        pricingSource = 'MANUAL_OVERRIDE';
        reason = `Manual discount override (${discountPercentage}%) applied`;
      }
    }

    // Guard: discount percentage between 0 and 100
    discountPercentage = Math.max(0, Math.min(100, discountPercentage));

    // Calculate effective unit price
    const discountAmountPerUnit = baseUnitPrice * (discountPercentage / 100);
    const effectiveUnitPrice = Math.max(0, baseUnitPrice - discountAmountPerUnit);

    // MRP Ceiling Validation: Invariant check (overrideable only with permission and reason)
    let mrpOverridden = false;
    let mrpOverrideReason: string | null = null;
    if (batch && retailPrice > 0) {
      if (baseUnitPrice > retailPrice || effectiveUnitPrice > retailPrice) {
        if (params.allowMrpOverride) {
          if (!params.mrpOverrideReason || !params.mrpOverrideReason.trim()) {
            throw new BadRequestException(
              `MRP override requires a valid justification reason for product "${product.name}"`,
            );
          }
          mrpOverridden = true;
          mrpOverrideReason = params.mrpOverrideReason.trim();
          pricingSource = 'MANUAL_OVERRIDE';
          reason = `MRP override applied (${mrpOverrideReason}) - ` + reason;
        } else {
          throw new BadRequestException(
            `Resolved selling price (Rs.${effectiveUnitPrice.toFixed(
              2,
            )}) exceeds Maximum Retail Price (MRP Rs.${retailPrice.toFixed(2)}) for product "${product.name}"`,
          );
        }
      }
    }

    // Financial Totals Calculation
    const billedQuantity = quantity;
    const totalQuantity = billedQuantity + bonusQuantity;
    const grossTotal = billedQuantity * baseUnitPrice;
    const discountAmount = billedQuantity * discountAmountPerUnit;
    const netLineTotal = Math.max(0, grossTotal - discountAmount);

    // Tax calculation
    const isTaxExempt = customer.isTaxExempt ?? (customer as any).is_tax_exempt ?? false;
    let taxPercentage = 0;
    if (!isTaxExempt) {
      taxPercentage =
        manualTaxPercentage !== undefined && manualTaxPercentage !== null
          ? Number(manualTaxPercentage)
          : Number(product.taxPercentage || 0);
    }
    const taxAmount = netLineTotal * (taxPercentage / 100);
    const finalTotalWithTax = netLineTotal + taxAmount;

    return {
      productId: product.id,
      batchId: batch?.id || null,
      billedQuantity,
      bonusQuantity,
      bonusProductId,
      totalQuantity,
      tradePrice,
      retailPrice,
      unitCost,
      baseUnitPrice,
      customPrice: customPriceRule?.customPrice ? Number(customPriceRule.customPrice) : null,
      discountPercentage,
      discountAmount,
      effectiveUnitPrice,
      grossTotal,
      netLineTotal,
      taxPercentage,
      taxAmount,
      finalTotalWithTax,
      pricingSource,
      pricingRuleId,
      schemeId,
      schemeName,
      reason,
      mrpOverridden,
      mrpOverrideReason,
    };
  }
}
