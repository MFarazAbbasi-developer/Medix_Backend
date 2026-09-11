import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';
import { DeliveryOrderStatus, DocumentType, Prisma } from '@prisma/client';
import { CreateDeliveryOrderDto } from './dto/create-delivery-order.dto';
import { RecordFulfillmentDto } from './dto/record-fulfillment.dto';
import { CancelDeliveryOrderDto } from './dto/cancel-delivery-order.dto';
import { QueryDeliveryOrdersDto } from './dto/query-delivery-orders.dto';

@Injectable()
export class DeliveryOrdersService {
  private readonly logger = new Logger(DeliveryOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly numberingService: NumberingService,
    private readonly audit: AuditService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  /**
   * Creates a new Delivery Order from an eligible POSTED sales invoice.
   * STRICT INVARIANT: Does NOT create StockMovement, modify inventory, or touch ledgers.
   */
  async createDeliveryOrder(dto: CreateDeliveryOrderDto, userId?: string) {
    const organizationId = await this.getOrganizationId();

    // 1. Fetch SalesInvoice and associated metadata
    const invoice = await this.prisma.salesInvoice.findFirst({
      where: { id: dto.salesInvoiceId, organizationId },
      include: {
        customer: true,
        salesman: true,
        route: true,
        items: {
          include: {
            product: {
              include: {
                unit: true,
              },
            },
            batch: true,
          },
        },
        deliveryOrder: true,
      },
    });

    if (!invoice) {
      throw new NotFoundException(
        `Sales invoice with ID "${dto.salesInvoiceId}" not found`,
      );
    }

    // 2. Validate Invoice Eligibility Rules
    if (invoice.status !== 'POSTED') {
      throw new BadRequestException(
        `Only POSTED sales invoices can create a Delivery Order. Current status is ${invoice.status}.`,
      );
    }

    if (invoice.customer.customerType === 'WALK_IN') {
      throw new BadRequestException(
        'Walk-in customer counter invoices cannot create Delivery Orders.',
      );
    }

    if (!invoice.deliveryAddress || invoice.deliveryAddress.trim().length === 0) {
      throw new BadRequestException(
        'Sales invoice does not have a valid delivery destination snapshot and cannot create a Delivery Order.',
      );
    }

    if (invoice.deliveryOrder) {
      throw new BadRequestException(
        `A Delivery Order ("${invoice.deliveryOrder.doNumber}") already exists for this sales invoice. Each invoice can only have one Delivery Order.`,
      );
    }

    if (!invoice.items || invoice.items.length === 0) {
      throw new BadRequestException(
        'Sales invoice has no items and cannot create a Delivery Order.',
      );
    }

    // 3. Generate sequential DO number via NumberingService
    const generated = await this.numberingService.generateNextNumber(
      'DELIVERY_ORDER' as DocumentType,
      invoice.branchId,
    );
    const doNumber = generated.documentNumber;

    // 4. Create DeliveryOrder and line items atomically
    return this.prisma.$transaction(async (tx) => {
      const deliveryOrder = await tx.deliveryOrder.create({
        data: {
          organizationId,
          branchId: invoice.branchId,
          warehouseId: invoice.warehouseId,
          salesInvoiceId: invoice.id,
          doNumber,
          status: 'READY',
          customerId: invoice.customerId,

          // Historical immutable snapshots from SalesInvoice:
          invoiceNumber: invoice.invoiceNumber || 'INV-UNKNOWN',
          invoiceDate: invoice.invoiceDate,
          customerName: invoice.customer.name,
          customerCode: invoice.customer.code,
          deliveryAddressId: invoice.deliveryAddressId || null,
          deliveryTitle: invoice.deliveryTitle || null,
          deliveryRecipient: invoice.deliveryRecipient || null,
          deliveryPhone: invoice.deliveryPhone || null,
          deliveryAddress: invoice.deliveryAddress || null,
          deliveryCity: invoice.deliveryCity || null,
          deliveryInstructions: invoice.deliveryInstructions || null,
          salesmanId: invoice.salesmanId || null,
          salesmanName: invoice.salesman?.name || null,
          salesmanCode: invoice.salesman?.code || null,
          routeId: invoice.routeId || null,
          routeName: invoice.route?.name || null,
          routeCode: invoice.route?.code || null,

          notes: dto.notes?.trim() || null,
          createdById: userId || null,

          items: {
            create: invoice.items.map((item) => ({
              salesInvoiceItemId: item.id,
              productId: item.productId,
              batchId: item.batchId,
              batchNumber: item.batchNumber,
              expiryDate: item.expiryDate,
              productName: item.product.name,
              productSku: item.product.sku,
              genericName: item.product.genericName || null,
              unitOfMeasurement:
                item.product.unit?.symbol || item.product.unit?.name || null,
              packSize: item.product.packSize || null,
              orderedBilledQuantity: item.billedQuantity,
              orderedBonusQuantity: item.bonusQuantity || 0,
              deliveredBilledQuantity: 0,
              deliveredBonusQuantity: 0,
            })),
          },
        },
        include: {
          customer: true,
          salesman: true,
          route: true,
          items: true,
          fulfillments: true,
        },
      });

      // Audit Log
      await this.audit.log({
        userId,
        action: 'CREATE_DELIVERY_ORDER',
        entity: 'DELIVERY_ORDER',
        entityId: deliveryOrder.id,
        details: {
          doNumber,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customer.name,
          itemCount: invoice.items.length,
        },
      });

      return deliveryOrder;
    });
  }

  /**
   * Records a partial or full fulfillment event for a Delivery Order.
   * Uses row-level locking for concurrency safety.
   * STRICT INVARIANT: Does NOT create StockMovement, modify inventory, or touch ledgers.
   */
  async recordFulfillment(
    id: string,
    dto: RecordFulfillmentDto,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock DeliveryOrder row FOR UPDATE
      const [lockedDo] = await tx.$queryRaw<any[]>(
        Prisma.sql`SELECT id, organization_id, branch_id, status, do_number, invoice_number
                   FROM delivery_orders
                   WHERE id = ${id} AND organization_id = ${organizationId}
                   FOR UPDATE`,
      );

      if (!lockedDo) {
        throw new NotFoundException(
          `Delivery Order with ID "${id}" not found`,
        );
      }

      if (lockedDo.status === 'CANCELLED') {
        throw new BadRequestException(
          'Cannot record fulfillment for a cancelled Delivery Order.',
        );
      }

      if (lockedDo.status === 'DELIVERED') {
        throw new BadRequestException(
          'Delivery Order is already fully delivered.',
        );
      }

      // 2. Deterministically lock affected DeliveryOrderItems in ascending ID order
      const itemIds = [
        ...new Set(dto.items.map((i) => i.deliveryOrderItemId)),
      ].sort();

      if (itemIds.length === 0) {
        throw new BadRequestException(
          'Fulfillment request must contain at least one item.',
        );
      }

      const lockedItems = await tx.$queryRaw<any[]>(
        Prisma.sql`SELECT id, delivery_order_id, product_name, ordered_billed_quantity, ordered_bonus_quantity, delivered_billed_quantity, delivered_bonus_quantity
                   FROM delivery_order_items
                   WHERE id IN (${Prisma.join(itemIds)}) AND delivery_order_id = ${id}
                   ORDER BY id
                   FOR UPDATE`,
      );

      if (lockedItems.length !== itemIds.length) {
        throw new BadRequestException(
          'One or more item IDs are invalid or do not belong to this Delivery Order.',
        );
      }

      const itemMap = new Map<string, any>(
        lockedItems.map((item) => [item.id, item]),
      );

      // 3. Validate fulfillment quantities per item
      let totalEventQty = 0;
      for (const itemDto of dto.items) {
        const locked = itemMap.get(itemDto.deliveryOrderItemId);
        const billed = itemDto.billedQuantity ?? 0;
        const bonus = itemDto.bonusQuantity ?? 0;

        if (billed < 0 || bonus < 0) {
          throw new BadRequestException(
            'Fulfillment quantities cannot be negative.',
          );
        }

        const pendingBilled =
          locked.ordered_billed_quantity - locked.delivered_billed_quantity;
        const pendingBonus =
          locked.ordered_bonus_quantity - locked.delivered_bonus_quantity;

        if (billed > pendingBilled) {
          throw new BadRequestException(
            `Delivered billed quantity (${billed}) exceeds pending billed quantity (${pendingBilled}) for "${locked.product_name}".`,
          );
        }

        if (bonus > pendingBonus) {
          throw new BadRequestException(
            `Delivered bonus quantity (${bonus}) exceeds pending bonus quantity (${pendingBonus}) for "${locked.product_name}".`,
          );
        }

        totalEventQty += billed + bonus;
      }

      if (totalEventQty <= 0) {
        throw new BadRequestException(
          'Total fulfillment quantity must be greater than zero.',
        );
      }

      // 4. Calculate next fulfillment number
      const count = await tx.deliveryFulfillment.count({
        where: { deliveryOrderId: id },
      });
      const fulfillmentNumber = count + 1;

      // 5. Create DeliveryFulfillment event and fulfillment items
      const nonZeroItems = dto.items.filter(
        (i) => (i.billedQuantity ?? 0) + (i.bonusQuantity ?? 0) > 0,
      );

      await tx.deliveryFulfillment.create({
        data: {
          organizationId,
          deliveryOrderId: id,
          fulfillmentNumber,
          fulfilledById: userId || null,
          notes: dto.notes?.trim() || null,
          items: {
            create: nonZeroItems.map((i) => ({
              deliveryOrderItemId: i.deliveryOrderItemId,
              deliveredBilledQuantity: i.billedQuantity ?? 0,
              deliveredBonusQuantity: i.bonusQuantity ?? 0,
            })),
          },
        },
      });

      // 6. Monotonically increment delivered quantities on items
      for (const itemDto of nonZeroItems) {
        await tx.deliveryOrderItem.update({
          where: { id: itemDto.deliveryOrderItemId },
          data: {
            deliveredBilledQuantity: {
              increment: itemDto.billedQuantity || 0,
            },
            deliveredBonusQuantity: {
              increment: itemDto.bonusQuantity || 0,
            },
          },
        });
      }

      // 7. Determine updated DeliveryOrder overall status
      const allItems = await tx.deliveryOrderItem.findMany({
        where: { deliveryOrderId: id },
      });

      const isAllDelivered = allItems.every(
        (it) =>
          it.deliveredBilledQuantity >= it.orderedBilledQuantity &&
          it.deliveredBonusQuantity >= it.orderedBonusQuantity,
      );

      const newStatus: DeliveryOrderStatus = isAllDelivered
        ? 'DELIVERED'
        : 'PARTIALLY_DELIVERED';

      const updated = await tx.deliveryOrder.update({
        where: { id },
        data: { status: newStatus },
        include: {
          customer: true,
          salesman: true,
          route: true,
          items: {
            include: {
              product: true,
              batch: true,
            },
          },
          fulfillments: {
            include: {
              fulfilledByUser: {
                select: { id: true, displayName: true, username: true },
              },
              items: {
                include: {
                  deliveryOrderItem: true,
                },
              },
            },
            orderBy: { fulfillmentNumber: 'desc' },
          },
        },
      });

      // Audit Log
      await this.audit.log({
        userId,
        action: 'RECORD_DELIVERY_FULFILLMENT',
        entity: 'DELIVERY_ORDER',
        entityId: id,
        details: {
          doNumber: lockedDo.do_number,
          fulfillmentNumber,
          newStatus,
          deliveredItemCount: nonZeroItems.length,
          totalUnitsDelivered: totalEventQty,
        },
      });

      return updated;
    });
  }

  /**
   * Cancels a Delivery Order.
   * Can only cancel if status is READY (0 fulfillment).
   */
  async cancelDeliveryOrder(
    id: string,
    dto: CancelDeliveryOrderDto,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();

    return this.prisma.$transaction(async (tx) => {
      // 1. Lock DeliveryOrder row FOR UPDATE
      const [lockedDo] = await tx.$queryRaw<any[]>(
        Prisma.sql`SELECT id, organization_id, status, do_number, invoice_number
                   FROM delivery_orders
                   WHERE id = ${id} AND organization_id = ${organizationId}
                   FOR UPDATE`,
      );

      if (!lockedDo) {
        throw new NotFoundException(
          `Delivery Order with ID "${id}" not found`,
        );
      }

      if (lockedDo.status === 'CANCELLED') {
        throw new BadRequestException('Delivery Order is already cancelled.');
      }

      if (lockedDo.status !== 'READY') {
        throw new BadRequestException(
          `Only READY Delivery Orders with zero fulfillment can be cancelled. Current status is ${lockedDo.status}. Please process a Sales Return instead.`,
        );
      }

      const cancelled = await tx.deliveryOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: userId || null,
          cancellationReason: dto.cancellationReason.trim(),
        },
        include: {
          customer: true,
          salesman: true,
          route: true,
          items: true,
          fulfillments: true,
        },
      });

      // Audit Log
      await this.audit.log({
        userId,
        action: 'CANCEL_DELIVERY_ORDER',
        entity: 'DELIVERY_ORDER',
        entityId: id,
        details: {
          doNumber: lockedDo.do_number,
          cancellationReason: dto.cancellationReason,
        },
      });

      return cancelled;
    });
  }

  /**
   * Retrieves paginated list of Delivery Orders with rich filtering.
   */
  async getDeliveryOrders(query: QueryDeliveryOrdersDto) {
    const organizationId = await this.getOrganizationId();
    const {
      search,
      status,
      customerId,
      routeId,
      salesmanId,
      branchId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.DeliveryOrderWhereInput = {
      organizationId,
      ...(status && { status }),
      ...(customerId && { customerId }),
      ...(routeId && { routeId }),
      ...(salesmanId && { salesmanId }),
      ...(branchId && { branchId }),
      ...(startDate || endDate
        ? {
            createdAt: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          }
        : {}),
      ...(search && {
        OR: [
          { doNumber: { contains: search, mode: 'insensitive' } },
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customerName: { contains: search, mode: 'insensitive' } },
          { customerCode: { contains: search, mode: 'insensitive' } },
          { deliveryAddress: { contains: search, mode: 'insensitive' } },
          { deliveryCity: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.deliveryOrder.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ createdAt: 'desc' }],
        include: {
          customer: {
            select: {
              id: true,
              code: true,
              name: true,
              phone: true,
            },
          },
          salesman: {
            select: { id: true, name: true, code: true, phone: true },
          },
          route: {
            select: { id: true, name: true, code: true, city: true, area: true },
          },
          branch: {
            select: { id: true, name: true, code: true },
          },
          items: true,
          _count: {
            select: { fulfillments: true },
          },
        },
      }),
      this.prisma.deliveryOrder.count({ where }),
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
   * Retrieves full details for a single Delivery Order.
   */
  async getDeliveryOrderById(id: string) {
    const organizationId = await this.getOrganizationId();

    const deliveryOrder = await this.prisma.deliveryOrder.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        branch: true,
        warehouse: true,
        salesman: true,
        route: true,
        createdByUser: {
          select: { id: true, displayName: true, username: true },
        },
        cancelledByUser: {
          select: { id: true, displayName: true, username: true },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
                packSize: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNumber: true,
                expiryDate: true,
                mfgDate: true,
              },
            },
          },
        },
        fulfillments: {
          include: {
            fulfilledByUser: {
              select: { id: true, displayName: true, username: true },
            },
            items: {
              include: {
                deliveryOrderItem: true,
              },
            },
          },
          orderBy: { fulfillmentNumber: 'desc' },
        },
      },
    });

    if (!deliveryOrder) {
      throw new NotFoundException(
        `Delivery Order with ID "${id}" not found`,
      );
    }

    return deliveryOrder;
  }

  /**
   * Finds POSTED invoices eligible to create a Delivery Order.
   * Requirement: POSTED, non-WALK_IN, has deliveryAddress, and NOT EXISTS DeliveryOrder (even cancelled).
   */
  async getEligibleInvoices(search?: string, customerId?: string, branchId?: string) {
    const organizationId = await this.getOrganizationId();

    const where: Prisma.SalesInvoiceWhereInput = {
      organizationId,
      ...(branchId && { branchId }),
      ...(customerId && { customerId }),
      status: 'POSTED',
      customer: {
        customerType: { not: 'WALK_IN' },
      },
      deliveryAddress: { not: null },
      deliveryOrder: { is: null }, // Strict NOT EXISTS check: no DO exists for this invoice
      ...(search && {
        OR: [
          { invoiceNumber: { contains: search, mode: 'insensitive' } },
          { customer: { name: { contains: search, mode: 'insensitive' } } },
          { customer: { code: { contains: search, mode: 'insensitive' } } },
          { deliveryAddress: { contains: search, mode: 'insensitive' } },
          { deliveryCity: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const invoices = await this.prisma.salesInvoice.findMany({
      where,
      take: 50,
      orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        customer: {
          select: {
            id: true,
            code: true,
            name: true,
            phone: true,
          },
        },
        salesman: {
          select: { id: true, name: true, code: true },
        },
        route: {
          select: { id: true, name: true, code: true, city: true, area: true },
        },
        _count: {
          select: { items: true },
        },
      },
    });

    return invoices;
  }
}
