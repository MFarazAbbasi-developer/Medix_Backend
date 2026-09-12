import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import {
  QuerySuggestionsDto,
  UpsertReplenishmentConfigDto,
  CreateDraftPosFromSuggestionsDto,
  SuggestionHealthStatus,
} from './dto/reorder-suggestions.dto';
import {
  Prisma,
  DocumentType,
  PurchaseOrderStatus,
  SalesInvoiceStatus,
  SalesReturnStatus,
  GrnStatus,
} from '@prisma/client';

export interface ProductSuggestionItem {
  productId: string;
  sku: string;
  name: string;
  genericName: string;
  dosageForm: string | null;
  strength: string | null;
  packSize: string | null;
  unitSymbol: string | null;
  categoryName: string | null;
  manufacturerName: string | null;
  isActive: boolean;

  // Live Stock Position (Base Inventory Units)
  physicalStock: number;
  saleableStock: number;
  shortExpiryStock: number;
  quarantinedStock: number;
  expiredStock: number;
  openPoQuantity: number;
  netPosition: number;

  // Sales Velocity & Demand
  lookbackDays: number;
  totalUnitsSold: number;
  averageDailySales: number;

  // Thresholds & Lead Times
  leadTimeDays: number;
  leadTimeDemand: number;
  safetyStockUnits: number;
  reorderPoint: number;
  reorderPointSource: 'CONFIGURED' | 'CALCULATED';
  targetStock: number;
  targetStockSource: 'CONFIGURED' | 'CALCULATED';
  minOrderQuantity: number;
  reorderQuantity: number | null;

  // Status & Recommendations
  healthStatus: SuggestionHealthStatus;
  isOverstocked: boolean;
  suggestedQuantity: number;
  estimatedUnitCost: number;
  estimatedPurchaseValue: number; // Informational only

  // Resolved Supplier
  supplier: {
    id: string;
    name: string;
    code: string;
    source: 'CONFIGURED' | 'LAST_PURCHASE' | 'UNASSIGNED';
  } | null;

  // Configuration metadata
  hasCustomConfig: boolean;
  configId: string | null;
}

@Injectable()
export class ReorderSuggestionsService {
  private readonly logger = new Logger(ReorderSuggestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst({
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  /**
   * Helper: Loads global reorder system settings.
   */
  private async getReorderSettings(orgId: string) {
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        organizationId: orgId,
        key: {
          in: [
            'REORDER_DEFAULT_LOOKBACK_DAYS',
            'REORDER_DEFAULT_LEAD_TIME_DAYS',
            'REORDER_DEFAULT_SAFETY_STOCK_DAYS',
            'REORDER_DEFAULT_TARGET_STOCK_DAYS',
            'REORDER_SHORT_EXPIRY_THRESHOLD_DAYS',
          ],
        },
      },
    });

    const settingsMap = new Map(settings.map((s) => [s.key, s.value]));

    return {
      defaultLookbackDays: parseInt(settingsMap.get('REORDER_DEFAULT_LOOKBACK_DAYS') || '30', 10),
      defaultLeadTimeDays: parseInt(settingsMap.get('REORDER_DEFAULT_LEAD_TIME_DAYS') || '7', 10),
      defaultSafetyDays: parseInt(settingsMap.get('REORDER_DEFAULT_SAFETY_STOCK_DAYS') || '7', 10),
      defaultTargetDays: parseInt(settingsMap.get('REORDER_DEFAULT_TARGET_STOCK_DAYS') || '30', 10),
      defaultShortExpiryDays: parseInt(settingsMap.get('REORDER_SHORT_EXPIRY_THRESHOLD_DAYS') || '90', 10),
    };
  }

  /**
   * Generates comprehensive, deterministic purchase suggestions across branch inventory.
   */
  async getSuggestions(query: QuerySuggestionsDto, contextualBranchId?: string) {
    const orgId = await this.getOrganizationId();
    const branchId = query.branchId || contextualBranchId;

    if (!branchId) {
      throw new BadRequestException('Branch ID is required for replenishment analysis');
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId: orgId, isActive: true },
    });
    if (!branch) {
      throw new NotFoundException(`Active branch with ID "${branchId}" not found`);
    }

    const globalSettings = await this.getReorderSettings(orgId);
    const lookbackDays = query.lookbackDays || globalSettings.defaultLookbackDays;
    const shortExpiryDays = query.shortExpiryDays || globalSettings.defaultShortExpiryDays;
    const excludeShortExpiry = query.excludeShortExpiry === true;

    const now = new Date();
    const lookbackStartDate = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

    // 1. Fetch products matching catalog filters
    const productWhere: Prisma.ProductWhereInput = {
      organizationId: orgId,
      isActive: true, // Suggestions strictly only for active products
    };

    if (query.categoryId) productWhere.categoryId = query.categoryId;
    if (query.manufacturerId) productWhere.manufacturerId = query.manufacturerId;

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      productWhere.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { genericName: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
      ];
    }

    const products = await this.prisma.product.findMany({
      where: productWhere,
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        manufacturer: { select: { id: true, name: true, code: true } },
        unit: { select: { id: true, name: true, symbol: true } },
        replenishmentConfigs: {
          where: { branchId },
          include: { preferredSupplier: { select: { id: true, name: true, code: true, isActive: true } } },
        },
        batches: {
          include: {
            stockMovements: {
              where: {
                organizationId: orgId,
                branchId,
                ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
              },
              include: {
                warehouse: { select: { id: true, name: true, code: true, warehouseType: true } },
              },
            },
          },
        },
      },
    });

    // 2. Fetch Open PO quantities strictly for this branch and organization
    const openPoItems = await this.prisma.purchaseOrderItem.findMany({
      where: {
        purchaseOrder: {
          organizationId: orgId,
          branchId,
          status: { in: [PurchaseOrderStatus.ISSUED, PurchaseOrderStatus.PARTIALLY_RECEIVED] },
        },
      },
      select: {
        productId: true,
        orderedQuantity: true,
        receivedQuantity: true,
      },
    });

    const openPoMap = new Map<string, number>();
    for (const poItem of openPoItems) {
      const openQty = Math.max(0, poItem.orderedQuantity - poItem.receivedQuantity);
      openPoMap.set(poItem.productId, (openPoMap.get(poItem.productId) || 0) + openQty);
    }

    // 3. Fetch sales invoice items in lookback window for velocity calculation
    const salesInvoiceItems = await this.prisma.salesInvoiceItem.findMany({
      where: {
        salesInvoice: {
          organizationId: orgId,
          branchId,
          status: SalesInvoiceStatus.POSTED,
          invoiceDate: { gte: lookbackStartDate },
          ...(query.warehouseId ? { warehouseId: query.warehouseId } : {}),
        },
      },
      select: {
        productId: true,
        billedQuantity: true,
        bonusQuantity: true,
        totalQuantity: true,
      },
    });

    const salesMap = new Map<string, number>();
    for (const item of salesInvoiceItems) {
      const qty = item.totalQuantity || (item.billedQuantity + (item.bonusQuantity || 0));
      salesMap.set(item.productId, (salesMap.get(item.productId) || 0) + qty);
    }

    // 4. Fetch sales returns in lookback window (by return transaction date)
    const salesReturnItems = await this.prisma.salesReturnItem.findMany({
      where: {
        salesReturn: {
          organizationId: orgId,
          branchId,
          status: SalesReturnStatus.POSTED,
          returnDate: { gte: lookbackStartDate },
        },
      },
      select: {
        productId: true,
        totalReturnedQuantity: true,
        returnedQuantity: true,
        bonusReturnedQuantity: true,
      },
    });

    const returnsMap = new Map<string, number>();
    for (const item of salesReturnItems) {
      const qty = item.totalReturnedQuantity || (item.returnedQuantity + (item.bonusReturnedQuantity || 0));
      returnsMap.set(item.productId, (returnsMap.get(item.productId) || 0) + qty);
    }

    // 5. Fetch last posted purchase history for supplier fallback & estimated unit cost
    const lastGrnItems = await this.prisma.goodsReceiveNoteItem.findMany({
      where: {
        grn: {
          organizationId: orgId,
          status: GrnStatus.POSTED,
        },
      },
      orderBy: { grn: { receivedDate: 'desc' } },
      distinct: ['productId'],
      select: {
        productId: true,
        unitCost: true,
        grn: {
          select: {
            supplier: { select: { id: true, name: true, code: true, isActive: true } },
          },
        },
      },
    });

    const lastPurchaseMap = new Map<
      string,
      {
        unitCost: number;
        supplier: { id: string; name: string; code: string; isActive: boolean } | null;
      }
    >();
    for (const grnItem of lastGrnItems) {
      lastPurchaseMap.set(grnItem.productId, {
        unitCost: Number(grnItem.unitCost),
        supplier: grnItem.grn?.supplier || null,
      });
    }

    // 6. Build Suggestions & Apply Replenishment Formulas
    const allSuggestions: ProductSuggestionItem[] = [];

    for (const prod of products) {
      const config = prod.replenishmentConfigs[0] || null;

      // Calculate Physical, Saleable, Short-Expiry, Quarantined, and Expired Stock
      let physicalStock = 0;
      let standardStock = 0;
      let shortExpiryStock = 0;
      let quarantinedStock = 0;
      let expiredStock = 0;
      let latestBatchCost = 0;

      for (const batch of prod.batches) {
        let batchTotal = 0;
        let batchStandard = 0;
        let batchQuarantine = 0;

        for (const m of batch.stockMovements) {
          batchTotal += m.quantity;
          if (m.warehouse?.warehouseType === 'STANDARD') {
            batchStandard += m.quantity;
          } else if (m.warehouse?.warehouseType === 'QUARANTINE') {
            batchQuarantine += m.quantity;
          }
        }

        if (batchTotal !== 0) {
          physicalStock += batchTotal;
          if (Number(batch.purchaseCost) > 0) {
            latestBatchCost = Number(batch.purchaseCost);
          }

          // Exact ExpiryService date comparison semantics
          const expiryDate = new Date(batch.expiryDate);
          const isExpired = expiryDate <= now;
          const daysUntilExpiry = Math.ceil(
            (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
          );

          if (batch.status === 'QUARANTINED' || batchQuarantine > 0) {
            quarantinedStock += batchTotal;
          } else if (batch.status === 'RECALLED') {
            quarantinedStock += batchTotal;
          } else if (isExpired) {
            expiredStock += batchTotal;
          } else if (batch.status === 'ACTIVE' && batchStandard > 0) {
            if (daysUntilExpiry <= shortExpiryDays) {
              shortExpiryStock += batchStandard;
              if (!excludeShortExpiry) {
                standardStock += batchStandard;
              }
            } else {
              standardStock += batchStandard;
            }
          }
        }
      }

      const saleableStock = Math.max(0, standardStock);
      const openPoQuantity = openPoMap.get(prod.id) || 0;
      const netPosition = saleableStock + openPoQuantity;

      // Velocity (ADS)
      const invoicedUnits = salesMap.get(prod.id) || 0;
      const returnedUnits = returnsMap.get(prod.id) || 0;
      const netUnitsSold = Math.max(0, invoicedUnits - returnedUnits);

      // Handle products created recently (< lookbackDays)
      const productAgeDays = Math.ceil((now.getTime() - new Date(prod.createdAt).getTime()) / (86400000));
      const effectiveLookbackDays = Math.min(lookbackDays, Math.max(1, productAgeDays));
      const averageDailySales = Number((netUnitsSold / effectiveLookbackDays).toFixed(2));

      // Thresholds: Lead time, Safety stock, ROP, Target stock
      const leadTimeDays = config?.leadTimeDays !== null && config?.leadTimeDays !== undefined
        ? config.leadTimeDays
        : globalSettings.defaultLeadTimeDays;

      const leadTimeDemand = Math.ceil(averageDailySales * leadTimeDays);
      const safetyStockUnits = Math.ceil(averageDailySales * globalSettings.defaultSafetyDays);

      let reorderPoint = 0;
      let reorderPointSource: 'CONFIGURED' | 'CALCULATED' = 'CALCULATED';

      if (config?.reorderPoint !== null && config?.reorderPoint !== undefined) {
        reorderPoint = config.reorderPoint;
        reorderPointSource = 'CONFIGURED';
      } else if (averageDailySales > 0) {
        reorderPoint = Math.ceil(averageDailySales * (leadTimeDays + globalSettings.defaultSafetyDays));
        reorderPointSource = 'CALCULATED';
      }

      const minOrderQuantity = config?.minOrderQuantity || 1;
      const reorderQuantity = config?.reorderQuantity || null;

      let targetStock = 0;
      let targetStockSource: 'CONFIGURED' | 'CALCULATED' = 'CALCULATED';

      if (config?.targetStock !== null && config?.targetStock !== undefined) {
        targetStock = config.targetStock;
        targetStockSource = 'CONFIGURED';
      } else if (averageDailySales > 0) {
        const calculatedTarget = Math.ceil(averageDailySales * globalSettings.defaultTargetDays);
        targetStock = Math.max(calculatedTarget, reorderPoint + minOrderQuantity);
        targetStockSource = 'CALCULATED';
      }

      // Health Classification
      let healthStatus: SuggestionHealthStatus = SuggestionHealthStatus.HEALTHY;
      const isReorderTriggered = (reorderPoint > 0 && netPosition <= reorderPoint) ||
        (reorderPoint === 0 && averageDailySales > 0 && netPosition === 0);

      if (isReorderTriggered) {
        healthStatus = SuggestionHealthStatus.REORDER_NEEDED;
      } else if (reorderPoint > 0 && netPosition <= Math.ceil(1.25 * reorderPoint)) {
        healthStatus = SuggestionHealthStatus.WATCH;
      } else {
        healthStatus = SuggestionHealthStatus.HEALTHY;
      }

      const isOverstocked = targetStock > 0 && saleableStock > Math.ceil(1.5 * targetStock);

      // Suggested Order Quantity
      let suggestedQuantity = 0;
      if (healthStatus === SuggestionHealthStatus.REORDER_NEEDED) {
        const rawDeficit = Math.max(0, targetStock - netPosition);
        let qty = Math.max(rawDeficit, minOrderQuantity);

        if (reorderQuantity && reorderQuantity > 0) {
          qty = Math.ceil(qty / reorderQuantity) * reorderQuantity;
        }
        suggestedQuantity = qty;
      }

      // Cost & Supplier Resolution
      const lastPurchase = lastPurchaseMap.get(prod.id);
      const estimatedUnitCost = lastPurchase?.unitCost || latestBatchCost || 0;
      const estimatedPurchaseValue = Number((suggestedQuantity * estimatedUnitCost).toFixed(2));

      // 4-Tier Supplier Resolution Precedence:
      // 1. Configured Preferred Supplier (if active)
      // 2. Last active GRN Supplier
      // 3. Unassigned
      let resolvedSupplier: ProductSuggestionItem['supplier'] = null;

      if (config?.preferredSupplier && config.preferredSupplier.isActive) {
        resolvedSupplier = {
          id: config.preferredSupplier.id,
          name: config.preferredSupplier.name,
          code: config.preferredSupplier.code,
          source: 'CONFIGURED',
        };
      } else if (lastPurchase?.supplier && lastPurchase.supplier.isActive) {
        resolvedSupplier = {
          id: lastPurchase.supplier.id,
          name: lastPurchase.supplier.name,
          code: lastPurchase.supplier.code,
          source: 'LAST_PURCHASE',
        };
      } else {
        resolvedSupplier = null;
      }

      allSuggestions.push({
        productId: prod.id,
        sku: prod.sku,
        name: prod.name,
        genericName: prod.genericName,
        dosageForm: prod.dosageForm,
        strength: prod.strength,
        packSize: prod.packSize,
        unitSymbol: prod.unit?.symbol || null,
        categoryName: prod.category?.name || null,
        manufacturerName: prod.manufacturer?.name || null,
        isActive: prod.isActive,
        physicalStock,
        saleableStock,
        shortExpiryStock,
        quarantinedStock,
        expiredStock,
        openPoQuantity,
        netPosition,
        lookbackDays,
        totalUnitsSold: netUnitsSold,
        averageDailySales,
        leadTimeDays,
        leadTimeDemand,
        safetyStockUnits,
        reorderPoint,
        reorderPointSource,
        targetStock,
        targetStockSource,
        minOrderQuantity,
        reorderQuantity,
        healthStatus,
        isOverstocked,
        suggestedQuantity,
        estimatedUnitCost,
        estimatedPurchaseValue,
        supplier: resolvedSupplier,
        hasCustomConfig: !!config,
        configId: config?.id || null,
      });
    }

    // 7. Apply Post-Calculation Filters (Status, Supplier)
    let filtered = allSuggestions;

    if (query.status && query.status !== SuggestionHealthStatus.ALL) {
      if (query.status === SuggestionHealthStatus.OVERSTOCK) {
        filtered = filtered.filter((s) => s.isOverstocked);
      } else {
        filtered = filtered.filter((s) => s.healthStatus === query.status);
      }
    }

    if (query.supplierId) {
      filtered = filtered.filter((s) => s.supplier?.id === query.supplierId);
    }

    // Summary Metrics
    let reorderNeededCount = 0;
    let watchCount = 0;
    let healthyCount = 0;
    let overstockCount = 0;
    let totalEstimatedValue = 0;
    let totalOpenPoUnits = 0;

    for (const s of allSuggestions) {
      if (s.healthStatus === SuggestionHealthStatus.REORDER_NEEDED) {
        reorderNeededCount++;
        totalEstimatedValue += s.estimatedPurchaseValue;
      } else if (s.healthStatus === SuggestionHealthStatus.WATCH) {
        watchCount++;
      } else if (s.healthStatus === SuggestionHealthStatus.HEALTHY) {
        healthyCount++;
      }

      if (s.isOverstocked) overstockCount++;
      totalOpenPoUnits += s.openPoQuantity;
    }

    // Pagination
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;
    const paginatedItems = filtered.slice(skip, skip + limit);

    return {
      summary: {
        totalSkusAnalyzed: allSuggestions.length,
        reorderNeededCount,
        watchCount,
        healthyCount,
        overstockCount,
        totalOpenPoUnits,
        totalEstimatedPurchaseValue: Number(totalEstimatedValue.toFixed(2)),
        lookbackDays,
        excludeShortExpiry,
        shortExpiryDays,
        asOfDate: now.toISOString(),
      },
      items: paginatedItems,
      meta: {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit) || 1,
      },
    };
  }

  /**
   * Retrieves high-level replenishment summary badge metrics.
   */
  async getSuggestionSummary(branchId?: string) {
    const orgId = await this.getOrganizationId();
    const effectiveBranchId = branchId || (await this.prisma.branch.findFirst({ where: { organizationId: orgId, isActive: true } }))?.id;

    if (!effectiveBranchId) {
      return { reorderNeededCount: 0, watchCount: 0, healthyCount: 0, totalEstimatedPurchaseValue: 0 };
    }

    const res = await this.getSuggestions({ page: 1, limit: 1 }, effectiveBranchId);
    return res.summary;
  }

  /**
   * Upserts branch-specific replenishment configuration with comprehensive validation.
   */
  async upsertReplenishmentConfig(
    productId: string,
    dto: UpsertReplenishmentConfigDto,
    branchId: string,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    // 1. Validate branch and product ownership
    const [branch, product] = await Promise.all([
      this.prisma.branch.findFirst({ where: { id: branchId, organizationId: orgId, isActive: true } }),
      this.prisma.product.findFirst({ where: { id: productId, organizationId: orgId } }),
    ]);

    if (!branch) {
      throw new BadRequestException(`Active branch with ID "${branchId}" not found`);
    }

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found`);
    }

    // 2. Strict validation rules
    if (dto.reorderPoint !== undefined && dto.reorderPoint !== null && dto.reorderPoint < 0) {
      throw new BadRequestException('Reorder point must be greater than or equal to 0');
    }

    if (dto.targetStock !== undefined && dto.targetStock !== null && dto.targetStock < 0) {
      throw new BadRequestException('Target stock must be greater than or equal to 0');
    }

    if (dto.minOrderQuantity !== undefined && dto.minOrderQuantity <= 0) {
      throw new BadRequestException('Minimum order quantity must be strictly greater than 0');
    }

    if (dto.reorderQuantity !== undefined && dto.reorderQuantity !== null && dto.reorderQuantity <= 0) {
      throw new BadRequestException('Reorder lot quantity must be strictly greater than 0');
    }

    if (dto.leadTimeDays !== undefined && dto.leadTimeDays !== null && dto.leadTimeDays < 0) {
      throw new BadRequestException('Lead time days must be greater than or equal to 0');
    }

    // Mandatory check: Reject targetStock < reorderPoint
    if (
      dto.reorderPoint !== undefined &&
      dto.reorderPoint !== null &&
      dto.targetStock !== undefined &&
      dto.targetStock !== null &&
      dto.targetStock < dto.reorderPoint
    ) {
      throw new BadRequestException(
        `Target stock (${dto.targetStock}) cannot be less than reorder point (${dto.reorderPoint})`,
      );
    }

    // 3. Validate preferred supplier if specified
    if (dto.preferredSupplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: dto.preferredSupplierId, organizationId: orgId, isActive: true },
      });
      if (!supplier) {
        throw new BadRequestException(
          `Active supplier with ID "${dto.preferredSupplierId}" not found for this organization`,
        );
      }
    }

    const config = await this.prisma.productReplenishmentConfig.upsert({
      where: {
        replenishment_branch_product_unique: {
          organizationId: orgId,
          branchId,
          productId,
        },
      },
      update: {
        reorderPoint: dto.reorderPoint !== undefined ? dto.reorderPoint : undefined,
        targetStock: dto.targetStock !== undefined ? dto.targetStock : undefined,
        minOrderQuantity: dto.minOrderQuantity !== undefined ? dto.minOrderQuantity : undefined,
        reorderQuantity: dto.reorderQuantity !== undefined ? dto.reorderQuantity : undefined,
        leadTimeDays: dto.leadTimeDays !== undefined ? dto.leadTimeDays : undefined,
        preferredSupplierId: dto.preferredSupplierId !== undefined ? dto.preferredSupplierId : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      },
      create: {
        organizationId: orgId,
        branchId,
        productId,
        reorderPoint: dto.reorderPoint ?? null,
        targetStock: dto.targetStock ?? null,
        minOrderQuantity: dto.minOrderQuantity || 1,
        reorderQuantity: dto.reorderQuantity ?? null,
        leadTimeDays: dto.leadTimeDays ?? null,
        preferredSupplierId: dto.preferredSupplierId ?? null,
        isActive: dto.isActive ?? true,
      },
      include: {
        preferredSupplier: { select: { id: true, name: true, code: true } },
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPSERT_REPLENISHMENT_CONFIG',
      entity: 'PRODUCT_REPLENISHMENT_CONFIG',
      entityId: config.id,
      details: {
        productId,
        productName: product.name,
        branchId,
        reorderPoint: config.reorderPoint,
        targetStock: config.targetStock,
      },
    });

    return config;
  }

  /**
   * Generates DRAFT Purchase Orders from selected suggestions with full server-side revalidation.
   */
  async createDraftPurchaseOrders(
    dto: CreateDraftPosFromSuggestionsDto,
    userId?: string,
  ) {
    const orgId = await this.getOrganizationId();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one item must be selected to create draft purchase orders');
    }

    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, organizationId: orgId, isActive: true },
    });
    if (!branch) {
      throw new BadRequestException(`Active branch with ID "${dto.branchId}" not found`);
    }

    // 1. Group items by supplier after full server-side resolution
    const supplierGroups = new Map<
      string,
      {
        supplierId: string;
        items: {
          productId: string;
          productName: string;
          orderedQuantity: number;
          unitCost: number;
          remarks?: string;
        }[];
      }
    >();

    for (const item of dto.items) {
      if (item.quantity <= 0) {
        throw new BadRequestException(`Order quantity for product "${item.productId}" must be strictly positive`);
      }

      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, organizationId: orgId, isActive: true },
        include: {
          replenishmentConfigs: { where: { branchId: dto.branchId } },
          batches: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      if (!product) {
        throw new BadRequestException(`Active product with ID "${item.productId}" not found`);
      }

      // Resolve supplier: Explicit DTO supplier > Config preferred supplier > Last GRN supplier
      let resolvedSupplierId: string | null = item.supplierId || null;

      if (!resolvedSupplierId) {
        const config = product.replenishmentConfigs[0];
        if (config?.preferredSupplierId) {
          resolvedSupplierId = config.preferredSupplierId;
        } else {
          // Check last GRN
          const lastGrn = await this.prisma.goodsReceiveNoteItem.findFirst({
            where: { productId: item.productId, grn: { organizationId: orgId, status: GrnStatus.POSTED } },
            orderBy: { grn: { receivedDate: 'desc' } },
            include: { grn: { select: { supplierId: true } } },
          });
          if (lastGrn?.grn?.supplierId) {
            resolvedSupplierId = lastGrn.grn.supplierId;
          }
        }
      }

      if (!resolvedSupplierId) {
        throw new BadRequestException(
          `Product "${product.name}" (SKU: ${product.sku}) has no resolved supplier. Please select a supplier before creating PO draft.`,
        );
      }

      // Verify supplier validity
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: resolvedSupplierId, organizationId: orgId, isActive: true },
      });
      if (!supplier) {
        throw new BadRequestException(`Active supplier with ID "${resolvedSupplierId}" not found`);
      }

      // Resolve unit cost
      let unitCost = item.unitCost;
      if (unitCost === undefined || unitCost === null || unitCost <= 0) {
        const lastGrn = await this.prisma.goodsReceiveNoteItem.findFirst({
          where: { productId: item.productId, grn: { organizationId: orgId, status: GrnStatus.POSTED } },
          orderBy: { grn: { receivedDate: 'desc' } },
          select: { unitCost: true },
        });
        unitCost = lastGrn ? Number(lastGrn.unitCost) : product.batches[0] ? Number(product.batches[0].purchaseCost) : 0;
      }

      if (!supplierGroups.has(resolvedSupplierId)) {
        supplierGroups.set(resolvedSupplierId, {
          supplierId: resolvedSupplierId,
          items: [],
        });
      }

      supplierGroups.get(resolvedSupplierId)!.items.push({
        productId: product.id,
        productName: product.name,
        orderedQuantity: item.quantity,
        unitCost,
        remarks: item.remarks || 'Generated via Purchase Suggestions',
      });
    }

    // 2. Atomically create DRAFT purchase orders for each supplier group
    const createdOrders: any[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const [supId, group] of supplierGroups.entries()) {
        const { documentNumber } = await this.numberingService.generateNextNumber(
          DocumentType.PURCHASE_ORDER,
          dto.branchId,
          tx,
        );

        let subtotal = 0;
        const poLineData = group.items.map((line) => {
          const lineGross = line.orderedQuantity * line.unitCost;
          subtotal += lineGross;
          return {
            productId: line.productId,
            orderedQuantity: line.orderedQuantity,
            receivedQuantity: 0,
            unitCost: new Prisma.Decimal(line.unitCost),
            discountPercentage: new Prisma.Decimal(0),
            taxPercentage: new Prisma.Decimal(0),
            lineTotal: new Prisma.Decimal(lineGross),
            remarks: line.remarks,
          };
        });

        const po = await tx.purchaseOrder.create({
          data: {
            organizationId: orgId,
            branchId: dto.branchId,
            supplierId: supId,
            poNumber: documentNumber,
            orderDate: new Date(),
            status: PurchaseOrderStatus.DRAFT,
            subtotal: new Prisma.Decimal(subtotal),
            discountAmount: new Prisma.Decimal(0),
            taxAmount: new Prisma.Decimal(0),
            netTotal: new Prisma.Decimal(subtotal),
            notes: dto.notes || 'Generated from Reorder & Purchase Suggestions workstation',
            createdById: userId,
            items: {
              create: poLineData,
            },
          },
          include: {
            supplier: { select: { id: true, name: true, code: true } },
            items: {
              include: { product: { select: { id: true, name: true, sku: true } } },
            },
          },
        });

        createdOrders.push(po);

        await this.auditService.log({
          userId,
          action: 'CREATE_DRAFT_PO_FROM_SUGGESTIONS',
          entity: 'PURCHASE_ORDER',
          entityId: po.id,
          details: {
            poNumber: po.poNumber,
            supplierId: supId,
            itemCount: po.items?.length ?? poLineData.length,
            netTotal: po.netTotal ? po.netTotal.toString() : subtotal.toString(),
          },
        });
      }
    });

    return {
      message: `Successfully created ${createdOrders.length} draft purchase order(s)`,
      orders: createdOrders,
    };
  }
}
