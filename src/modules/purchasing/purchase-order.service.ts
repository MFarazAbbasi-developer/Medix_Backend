import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { CreatePurchaseOrderDto } from './dto/create-po.dto';
import { UpdatePurchaseOrderDto } from './dto/update-po.dto';
import { QueryPurchaseOrderDto } from './dto/query-po.dto';
import { Prisma, DocumentType, PurchaseOrderStatus } from '@prisma/client';

@Injectable()
export class PurchaseOrderService {
  private readonly logger = new Logger(PurchaseOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  /**
   * Helper to calculate item totals and document summary.
   */
  private calculatePoTotals(items: CreatePurchaseOrderDto['items']) {
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const computedItems = items.map((item) => {
      const gross = item.orderedQuantity * item.unitCost;
      const discountPct = item.discountPercentage || 0;
      const taxPct = item.taxPercentage || 0;

      const discount = gross * (discountPct / 100);
      const taxable = gross - discount;
      const tax = taxable * (taxPct / 100);
      const lineTotal = taxable + tax;

      subtotal += gross;
      totalDiscount += discount;
      totalTax += tax;

      return {
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        receivedQuantity: 0,
        unitCost: new Prisma.Decimal(item.unitCost),
        discountPercentage: new Prisma.Decimal(discountPct),
        taxPercentage: new Prisma.Decimal(taxPct),
        lineTotal: new Prisma.Decimal(lineTotal),
        remarks: item.remarks?.trim() || null,
      };
    });

    const netTotal = subtotal - totalDiscount + totalTax;

    return {
      subtotal: new Prisma.Decimal(subtotal),
      discountAmount: new Prisma.Decimal(totalDiscount),
      taxAmount: new Prisma.Decimal(totalTax),
      netTotal: new Prisma.Decimal(netTotal),
      computedItems,
    };
  }

  /**
   * Creates a new draft Purchase Order.
   */
  async create(dto: CreatePurchaseOrderDto, userId?: string) {
    const orgId = await this.getOrganizationId();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Purchase order must contain at least one item');
    }

    // 1. Verify branch & supplier
    const [branch, supplier] = await Promise.all([
      this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId: orgId, isActive: true },
      }),
      this.prisma.supplier.findFirst({
        where: { id: dto.supplierId, organizationId: orgId, isActive: true },
      }),
    ]);

    if (!branch) {
      throw new BadRequestException(`Active branch with ID "${dto.branchId}" not found`);
    }

    if (!supplier) {
      throw new BadRequestException(`Active supplier with ID "${dto.supplierId}" not found`);
    }

    // 2. Verify all products
    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, organizationId: orgId },
    });

    if (products.length !== new Set(productIds).size) {
      throw new BadRequestException('One or more selected products do not exist for this organization');
    }

    const { subtotal, discountAmount, taxAmount, netTotal, computedItems } =
      this.calculatePoTotals(dto.items);

    // 3. Atomically reserve PO Number
    const { documentNumber } = await this.numberingService.generateNextNumber(
      DocumentType.PURCHASE_ORDER,
      dto.branchId,
    );

    const po = await this.prisma.purchaseOrder.create({
      data: {
        organizationId: orgId,
        branchId: dto.branchId,
        supplierId: dto.supplierId,
        poNumber: documentNumber,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : new Date(),
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
        status: PurchaseOrderStatus.DRAFT,
        subtotal,
        discountAmount,
        taxAmount,
        netTotal,
        notes: dto.notes?.trim() || null,
        createdById: userId,
        items: {
          create: computedItems,
        },
      },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_PURCHASE_ORDER',
      entity: 'PURCHASE_ORDER',
      entityId: po.id,
      details: {
        poNumber: po.poNumber,
        supplier: supplier.name,
        itemCount: po.items.length,
        netTotal: po.netTotal.toString(),
      },
    });

    return po;
  }

  /**
   * Retrieves paginated purchase orders with search and filtering.
   */
  async findAll(query: QueryPurchaseOrderDto) {
    const orgId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.PurchaseOrderWhereInput = {
      organizationId: orgId,
    };

    if (query.status) {
      where.status = query.status;
    }

    if (query.supplierId) {
      where.supplierId = query.supplierId;
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { poNumber: { contains: term, mode: 'insensitive' } },
        { supplier: { name: { contains: term, mode: 'insensitive' } } },
        { supplier: { code: { contains: term, mode: 'insensitive' } } },
        { notes: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, code: true } },
          _count: {
            select: {
              items: true,
              goodsReceiveNotes: true,
            },
          },
        },
      }),
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

  /**
   * Retrieves full purchase order by ID with line items and GRNs.
   */
  async findById(id: string) {
    const orgId = await this.getOrganizationId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        supplier: true,
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
                packSize: true,
                unit: true,
              },
            },
          },
        },
        goodsReceiveNotes: {
          select: {
            id: true,
            grnNumber: true,
            receivedDate: true,
            status: true,
            netTotal: true,
          },
        },
      },
    });

    if (!po) {
      throw new NotFoundException(`Purchase Order with ID "${id}" not found`);
    }

    return po;
  }

  /**
   * Updates a DRAFT purchase order.
   */
  async update(id: string, dto: UpdatePurchaseOrderDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true },
    });

    if (!po) {
      throw new NotFoundException(`Purchase Order with ID "${id}" not found`);
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(
        `Only DRAFT purchase orders can be edited. Current status: ${po.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      let subtotal = po.subtotal;
      let discountAmount = po.discountAmount;
      let taxAmount = po.taxAmount;
      let netTotal = po.netTotal;

      if (dto.items && dto.items.length > 0) {
        // Delete existing items
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: id },
        });

        const totals = this.calculatePoTotals(dto.items);
        subtotal = totals.subtotal;
        discountAmount = totals.discountAmount;
        taxAmount = totals.taxAmount;
        netTotal = totals.netTotal;

        await tx.purchaseOrderItem.createMany({
          data: totals.computedItems.map((item) => ({
            ...item,
            purchaseOrderId: id,
          })),
        });
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          supplierId: dto.supplierId || undefined,
          orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
          expectedDate: dto.expectedDate !== undefined ? (dto.expectedDate ? new Date(dto.expectedDate) : null) : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
          subtotal,
          discountAmount,
          taxAmount,
          netTotal,
        },
        include: {
          branch: true,
          supplier: true,
          items: {
            include: { product: true },
          },
        },
      });

      await this.auditService.log({
        userId,
        action: 'UPDATE_PURCHASE_ORDER',
        entity: 'PURCHASE_ORDER',
        entityId: id,
        details: {
          poNumber: updated.poNumber,
          netTotal: updated.netTotal.toString(),
        },
      });

      return updated;
    });
  }

  /**
   * Issues a DRAFT purchase order.
   */
  async issue(id: string, userId?: string) {
    const orgId = await this.getOrganizationId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!po) {
      throw new NotFoundException(`Purchase Order with ID "${id}" not found`);
    }

    if (po.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT purchase orders can be issued');
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.ISSUED },
    });

    await this.auditService.log({
      userId,
      action: 'ISSUE_PURCHASE_ORDER',
      entity: 'PURCHASE_ORDER',
      entityId: id,
      details: { poNumber: po.poNumber },
    });

    return updated;
  }

  /**
   * Cancels a purchase order.
   */
  async cancel(id: string, userId?: string) {
    const orgId = await this.getOrganizationId();
    const po = await this.prisma.purchaseOrder.findFirst({
      where: { id, organizationId: orgId },
      include: { items: true },
    });

    if (!po) {
      throw new NotFoundException(`Purchase Order with ID "${id}" not found`);
    }

    if (po.status === PurchaseOrderStatus.RECEIVED || po.status === PurchaseOrderStatus.PARTIALLY_RECEIVED) {
      const hasReceived = po.items.some((i) => i.receivedQuantity > 0);
      if (hasReceived) {
        throw new BadRequestException('Cannot cancel purchase orders with received stock');
      }
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: PurchaseOrderStatus.CANCELLED },
    });

    await this.auditService.log({
      userId,
      action: 'CANCEL_PURCHASE_ORDER',
      entity: 'PURCHASE_ORDER',
      entityId: id,
      details: { poNumber: po.poNumber },
    });

    return updated;
  }
}
