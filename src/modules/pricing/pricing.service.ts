import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PricingEngineService } from './pricing-engine.service';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { QueryPricingRuleDto } from './dto/query-pricing-rule.dto';
import { CreateSchemeDto } from './dto/create-scheme.dto';
import { UpdateSchemeDto } from './dto/update-scheme.dto';
import { QuerySchemeDto } from './dto/query-scheme.dto';
import { ResolvePricingDto } from './dto/resolve-pricing.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly engine: PricingEngineService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (!org) {
      throw new NotFoundException('Organization not configured in system');
    }
    return org.id;
  }

  // ==========================================
  // CUSTOMER PRICING RULES CRUD
  // ==========================================

  async createPricingRule(dto: CreatePricingRuleDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    const [customer, product] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId },
      }),
      this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${dto.customerId}" not found`);
    }
    if (!product) {
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    if (dto.customPrice === undefined && dto.discountPercentage === undefined) {
      throw new BadRequestException(
        'At least one of customPrice or discountPercentage must be specified',
      );
    }

    if (dto.startDate && dto.endDate) {
      if (new Date(dto.endDate) < new Date(dto.startDate)) {
        throw new BadRequestException('End date cannot be earlier than start date');
      }
    }

    const rule = await this.prisma.customerPricingRule.create({
      data: {
        organizationId,
        customerId: dto.customerId,
        productId: dto.productId,
        customPrice:
          dto.customPrice !== undefined
            ? new Prisma.Decimal(dto.customPrice)
            : null,
        discountPercentage:
          dto.discountPercentage !== undefined
            ? new Prisma.Decimal(dto.discountPercentage)
            : null,
        minQuantity: dto.minQuantity || 1,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        notes: dto.notes?.trim() || null,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'CREATE_PRICING_RULE',
      entity: 'CUSTOMER_PRICING_RULE',
      entityId: rule.id,
      details: {
        customerId: dto.customerId,
        customerName: customer.name,
        productId: dto.productId,
        productName: product.name,
        customPrice: dto.customPrice,
        discountPercentage: dto.discountPercentage,
      },
    });

    return rule;
  }

  async getPricingRules(query: QueryPricingRuleDto) {
    const organizationId = await this.getOrganizationId();
    const { search, customerId, productId, isActive, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerPricingRuleWhereInput = {
      organizationId,
      ...(customerId && { customerId }),
      ...(productId && { productId }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { code: { contains: search, mode: 'insensitive' } } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
          { product: { sku: { contains: search, mode: 'insensitive' } } },
          { notes: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.customerPricingRule.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          customer: {
            select: { id: true, code: true, name: true, customerType: true },
          },
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              genericName: true,
              taxPercentage: true,
            },
          },
        },
      }),
      this.prisma.customerPricingRule.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getPricingRuleById(id: string) {
    const organizationId = await this.getOrganizationId();
    const rule = await this.prisma.customerPricingRule.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        product: true,
      },
    });

    if (!rule) {
      throw new NotFoundException(`Pricing rule with ID "${id}" not found`);
    }

    return rule;
  }

  async updatePricingRule(
    id: string,
    dto: UpdatePricingRuleDto,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();
    const existing = await this.prisma.customerPricingRule.findFirst({
      where: { id, organizationId },
      include: { customer: true, product: true },
    });

    if (!existing) {
      throw new NotFoundException(`Pricing rule with ID "${id}" not found`);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;

    if (startDate && endDate && endDate < startDate) {
      throw new BadRequestException('End date cannot be earlier than start date');
    }

    const updated = await this.prisma.customerPricingRule.update({
      where: { id },
      data: {
        ...(dto.customPrice !== undefined && {
          customPrice:
            dto.customPrice !== null
              ? new Prisma.Decimal(dto.customPrice)
              : null,
        }),
        ...(dto.discountPercentage !== undefined && {
          discountPercentage:
            dto.discountPercentage !== null
              ? new Prisma.Decimal(dto.discountPercentage)
              : null,
        }),
        ...(dto.minQuantity !== undefined && { minQuantity: dto.minQuantity }),
        ...(dto.startDate !== undefined && {
          startDate: dto.startDate ? new Date(dto.startDate) : null,
        }),
        ...(dto.endDate !== undefined && {
          endDate: dto.endDate ? new Date(dto.endDate) : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'UPDATE_PRICING_RULE',
      entity: 'CUSTOMER_PRICING_RULE',
      entityId: id,
      details: { changes: dto },
    });

    return updated;
  }

  async deletePricingRule(id: string, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const existing = await this.prisma.customerPricingRule.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Pricing rule with ID "${id}" not found`);
    }

    await this.prisma.customerPricingRule.delete({ where: { id } });

    await this.audit.log({
      userId,
      action: 'DELETE_PRICING_RULE',
      entity: 'CUSTOMER_PRICING_RULE',
      entityId: id,
      details: { previousData: existing },
    });

    return { success: true, message: 'Pricing rule deleted successfully' };
  }

  // ==========================================
  // PROMOTIONAL SCHEMES CRUD
  // ==========================================

  async createScheme(dto: CreateSchemeDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, organizationId },
    });
    if (!product) {
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    if (dto.bonusProductId) {
      const bonusProd = await this.prisma.product.findFirst({
        where: { id: dto.bonusProductId, organizationId },
      });
      if (!bonusProd) {
        throw new NotFoundException(
          `Bonus product with ID "${dto.bonusProductId}" not found`,
        );
      }
    }

    if (dto.customerId) {
      const cust = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId },
      });
      if (!cust) {
        throw new NotFoundException(`Customer with ID "${dto.customerId}" not found`);
      }
    }

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    if (endDate < startDate) {
      throw new BadRequestException('End date cannot be earlier than start date');
    }

    // Check code uniqueness within org
    const existingCode = await this.prisma.promotionalScheme.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code: dto.code.trim().toUpperCase(),
        },
      },
    });

    if (existingCode) {
      throw new BadRequestException(
        `Scheme code "${dto.code.trim().toUpperCase()}" already exists in organization`,
      );
    }

    const scheme = await this.prisma.promotionalScheme.create({
      data: {
        organizationId,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        description: dto.description?.trim() || null,
        schemeType: dto.schemeType,
        productId: dto.productId,
        minQuantity: dto.minQuantity || 1,
        bonusQuantity: dto.bonusQuantity || 0,
        bonusProductId: dto.bonusProductId || null,
        discountPercentage:
          dto.discountPercentage !== undefined && dto.discountPercentage !== null
            ? new Prisma.Decimal(dto.discountPercentage)
            : null,
        overridePrice:
          dto.overridePrice !== undefined && dto.overridePrice !== null
            ? new Prisma.Decimal(dto.overridePrice)
            : null,
        customerId: dto.customerId || null,
        customerType: dto.customerType || null,
        startDate,
        endDate,
        isActive: dto.isActive !== undefined ? dto.isActive : true,
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        bonusProduct: { select: { id: true, sku: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'CREATE_PROMOTIONAL_SCHEME',
      entity: 'PROMOTIONAL_SCHEME',
      entityId: scheme.id,
      details: {
        name: scheme.name,
        code: scheme.code,
        schemeType: scheme.schemeType,
        productId: scheme.productId,
        minQuantity: scheme.minQuantity,
        bonusQuantity: scheme.bonusQuantity,
      },
    });

    return scheme;
  }

  async getSchemes(query: QuerySchemeDto) {
    const organizationId = await this.getOrganizationId();
    const {
      search,
      schemeType,
      productId,
      customerId,
      customerType,
      isActive,
      page = 1,
      limit = 50,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.PromotionalSchemeWhereInput = {
      organizationId,
      ...(schemeType && { schemeType }),
      ...(productId && { productId }),
      ...(customerId && { customerId }),
      ...(customerType && { customerType }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
          { product: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.promotionalScheme.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          product: {
            select: { id: true, sku: true, name: true, genericName: true },
          },
          bonusProduct: {
            select: { id: true, sku: true, name: true },
          },
          customer: {
            select: { id: true, code: true, name: true, customerType: true },
          },
        },
      }),
      this.prisma.promotionalScheme.count({ where }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async getSchemeById(id: string) {
    const organizationId = await this.getOrganizationId();
    const scheme = await this.prisma.promotionalScheme.findFirst({
      where: { id, organizationId },
      include: {
        product: true,
        bonusProduct: true,
        customer: true,
      },
    });

    if (!scheme) {
      throw new NotFoundException(`Promotional scheme with ID "${id}" not found`);
    }

    return scheme;
  }

  async updateScheme(id: string, dto: UpdateSchemeDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const existing = await this.prisma.promotionalScheme.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Promotional scheme with ID "${id}" not found`);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : existing.startDate;
    const endDate = dto.endDate ? new Date(dto.endDate) : existing.endDate;

    if (endDate < startDate) {
      throw new BadRequestException('End date cannot be earlier than start date');
    }

    const updated = await this.prisma.promotionalScheme.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.code !== undefined && { code: dto.code.trim().toUpperCase() }),
        ...(dto.description !== undefined && {
          description: dto.description?.trim() || null,
        }),
        ...(dto.schemeType !== undefined && { schemeType: dto.schemeType }),
        ...(dto.productId !== undefined && { productId: dto.productId }),
        ...(dto.minQuantity !== undefined && { minQuantity: dto.minQuantity }),
        ...(dto.bonusQuantity !== undefined && {
          bonusQuantity: dto.bonusQuantity,
        }),
        ...(dto.bonusProductId !== undefined && {
          bonusProductId: dto.bonusProductId || null,
        }),
        ...(dto.discountPercentage !== undefined && {
          discountPercentage:
            dto.discountPercentage !== null
              ? new Prisma.Decimal(dto.discountPercentage)
              : null,
        }),
        ...(dto.overridePrice !== undefined && {
          overridePrice:
            dto.overridePrice !== null
              ? new Prisma.Decimal(dto.overridePrice)
              : null,
        }),
        ...(dto.customerId !== undefined && {
          customerId: dto.customerId || null,
        }),
        ...(dto.customerType !== undefined && {
          customerType: dto.customerType || null,
        }),
        ...(dto.startDate !== undefined && { startDate }),
        ...(dto.endDate !== undefined && { endDate }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        bonusProduct: { select: { id: true, sku: true, name: true } },
        customer: { select: { id: true, code: true, name: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'UPDATE_PROMOTIONAL_SCHEME',
      entity: 'PROMOTIONAL_SCHEME',
      entityId: id,
      details: { changes: dto },
    });

    return updated;
  }

  async deleteScheme(id: string, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const existing = await this.prisma.promotionalScheme.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(`Promotional scheme with ID "${id}" not found`);
    }

    await this.prisma.promotionalScheme.delete({ where: { id } });

    await this.audit.log({
      userId,
      action: 'DELETE_PROMOTIONAL_SCHEME',
      entity: 'PROMOTIONAL_SCHEME',
      entityId: id,
      details: { previousData: existing },
    });

    return { success: true, message: 'Promotional scheme deleted successfully' };
  }

  // ==========================================
  // PRICING RESOLUTION & SIMULATION PREVIEW
  // ==========================================

  async previewPricing(dto: ResolvePricingDto) {
    const organizationId = await this.getOrganizationId();

    const [customer, product, pricingSetting] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, organizationId },
      }),
      this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId },
        include: {
          batches: {
            where: { status: 'ACTIVE', expiryDate: { gt: new Date() } },
            orderBy: [{ expiryDate: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
      this.prisma.systemSetting.findUnique({
        where: {
          organizationId_key: {
            organizationId,
            key: 'DEFAULT_SALES_PRICING_BASE',
          },
        },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${dto.customerId}" not found`);
    }
    if (!product) {
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    const defaultPricingBase = pricingSetting?.value === 'MRP' ? 'MRP' : 'TP';

    let selectedBatch = null;
    if (dto.batchId) {
      selectedBatch = product.batches.find((b) => b.id === dto.batchId) || null;
    } else if (product.batches.length > 0) {
      selectedBatch = product.batches[0];
    }

    // Fetch active rules & schemes
    const now = new Date();
    const [pricingRules, promotionalSchemes] = await Promise.all([
      this.prisma.customerPricingRule.findMany({
        where: {
          organizationId,
          customerId: customer.id,
          productId: product.id,
          isActive: true,
        },
      }),
      this.prisma.promotionalScheme.findMany({
        where: {
          organizationId,
          productId: product.id,
          isActive: true,
          startDate: { lte: now },
          endDate: { gte: now },
        },
      }),
    ]);

    const resolution = this.engine.resolvePricing({
      product,
      batch: selectedBatch,
      customer,
      quantity: dto.quantity,
      pricingRules,
      promotionalSchemes,
      defaultPricingBase,
      manualUnitPrice: dto.manualUnitPrice,
      manualDiscountPercentage: dto.manualDiscountPercentage,
    });

    return {
      customer: {
        id: customer.id,
        code: customer.code,
        name: customer.name,
        customerType: customer.customerType,
        defaultDiscountPercentage: Number(customer.defaultDiscountPercentage || 0),
        isTaxExempt: customer.isTaxExempt,
      },
      product: {
        id: product.id,
        sku: product.sku,
        name: product.name,
        genericName: product.genericName,
        taxPercentage: Number(product.taxPercentage),
      },
      availableBatches: product.batches.map((b) => ({
        id: b.id,
        batchNumber: b.batchNumber,
        expiryDate: b.expiryDate,
        tradePrice: Number(b.tradePrice),
        retailPrice: Number(b.retailPrice),
        purchaseCost: Number(b.purchaseCost),
      })),
      applicableSchemes: promotionalSchemes.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        schemeType: s.schemeType,
        minQuantity: s.minQuantity,
        bonusQuantity: s.bonusQuantity,
        discountPercentage: s.discountPercentage ? Number(s.discountPercentage) : null,
        overridePrice: s.overridePrice ? Number(s.overridePrice) : null,
      })),
      resolution,
    };
  }
}
