import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { QueryCustomerDto, QueryCustomerLedgerDto } from './dto/query-customer.dto';
import { UpsertCustomerPricingRuleDto } from './dto/customer-pricing.dto';
import {
  CreateCustomerAddressDto,
  UpdateCustomerAddressDto,
  QueryCustomerAddressDto,
} from './dto/customer-address.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  private async getDefaultBranchId(organizationId: string): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { organizationId, isActive: true },
      orderBy: [{ isHeadOffice: 'desc' }, { createdAt: 'asc' }],
    });
    if (!branch) {
      throw new NotFoundException('No active branch found');
    }
    return branch.id;
  }

  /**
   * Helper: Validates salesman and route compatibility for customer.
   */
  private async validateCustomerSalesmanAndRoute(
    organizationId: string,
    salesmanId?: string | null,
    routeId?: string | null,
  ) {
    let salesman: { id: string; name: string; branchId: string | null } | null = null;
    let route: { id: string; name: string; branchId: string | null } | null = null;

    if (salesmanId) {
      salesman = await this.prisma.salesman.findFirst({
        where: { id: salesmanId, organizationId },
        select: { id: true, name: true, branchId: true },
      });
      if (!salesman) {
        throw new BadRequestException(`Default salesman with ID "${salesmanId}" does not exist in this organization.`);
      }
    }

    if (routeId) {
      route = await this.prisma.salesRoute.findFirst({
        where: { id: routeId, organizationId },
        select: { id: true, name: true, branchId: true },
      });
      if (!route) {
        throw new BadRequestException(`Sales route with ID "${routeId}" does not exist in this organization.`);
      }
    }

    if (salesman && route) {
      // 1. Branch compatibility
      if (salesman.branchId && route.branchId && salesman.branchId !== route.branchId) {
        throw new BadRequestException(
          `Branch mismatch: Salesman "${salesman.name}" and Route "${route.name}" belong to different branches.`,
        );
      }

      // 2. Many-to-many SalesmanRoute check
      const assignment = await this.prisma.salesmanRoute.findUnique({
        where: {
          salesmanId_routeId: {
            salesmanId: salesman.id,
            routeId: route.id,
          },
        },
      });

      if (!assignment) {
        throw new BadRequestException(
          `Salesman "${salesman.name}" is not assigned to route "${route.name}". Please assign the salesman to this route first or choose a valid route.`,
        );
      }
    }
  }

  /**
   * Creates a new Customer record with optional opening balance entry.
   */
  async createCustomer(dto: CreateCustomerDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const branchId = await this.getDefaultBranchId(organizationId);

    const existing = await this.prisma.customer.findUnique({
      where: {
        organizationId_code: {
          organizationId,
          code: dto.code.trim().toUpperCase(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Customer code "${dto.code}" already exists in this organization`,
      );
    }

    // Validate salesman & route compatibility
    if (dto.defaultSalesmanId || dto.routeId) {
      await this.validateCustomerSalesmanAndRoute(
        organizationId,
        dto.defaultSalesmanId,
        dto.routeId,
      );
    }

    const openingBalance = dto.openingBalance ? Number(dto.openingBalance) : 0;

    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          organizationId,
          code: dto.code.trim().toUpperCase(),
          name: dto.name.trim(),
          customerType: dto.customerType || 'RETAIL_PHARMACY',
          contactPerson: dto.contactPerson?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          address: dto.address?.trim() || null,
          city: dto.city?.trim() || null,
          ntn: dto.ntn?.trim() || null,
          strn: dto.strn?.trim() || null,
          drugSaleLicenseNo: dto.drugSaleLicenseNo?.trim() || null,
          creditDays: dto.creditDays ?? 0,
          creditLimit: new Prisma.Decimal(dto.creditLimit ?? 0),
          currentBalance: new Prisma.Decimal(openingBalance),
          defaultDiscountPercentage: new Prisma.Decimal(
            dto.defaultDiscountPercentage ?? 0,
          ),
          defaultSalesmanId: dto.defaultSalesmanId || null,
          routeId: dto.routeId || null,
          isTaxExempt: dto.isTaxExempt ?? false,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
        include: {
          defaultSalesman: { select: { id: true, name: true, code: true, phone: true } },
          route: { select: { id: true, name: true, code: true, city: true, area: true } },
        },
      });

      if (openingBalance > 0) {
        await tx.customerLedgerEntry.create({
          data: {
            organizationId,
            branchId,
            customerId: created.id,
            entryType: 'OPENING_BALANCE',
            referenceNumber: 'OPENING',
            debit: new Prisma.Decimal(openingBalance),
            credit: new Prisma.Decimal(0),
            runningBalance: new Prisma.Decimal(openingBalance),
            notes: 'Initial customer opening balance setup',
            createdByUserId: userId || null,
          },
        });
      }

      return created;
    });

    await this.audit.log({
      userId,
      action: 'CREATE_CUSTOMER',
      entity: 'CUSTOMER',
      entityId: customer.id,
      details: {
        code: customer.code,
        name: customer.name,
        customerType: customer.customerType,
        defaultSalesmanId: customer.defaultSalesmanId,
        routeId: customer.routeId,
        openingBalance,
      },
    });

    return customer;
  }

  /**
   * Updates an existing Customer profile.
   */
  async updateCustomer(id: string, dto: UpdateCustomerDto, userId?: string) {
    const organizationId = await this.getOrganizationId();
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${id}" not found`);
    }

    if (dto.code && dto.code.trim().toUpperCase() !== customer.code) {
      const codeTaken = await this.prisma.customer.findUnique({
        where: {
          organizationId_code: {
            organizationId,
            code: dto.code.trim().toUpperCase(),
          },
        },
      });
      if (codeTaken) {
        throw new ConflictException(
          `Customer code "${dto.code}" is already in use`,
        );
      }
    }

    // Resolve target salesman and route
    const targetSalesmanId =
      dto.defaultSalesmanId !== undefined ? dto.defaultSalesmanId : customer.defaultSalesmanId;
    const targetRouteId =
      dto.routeId !== undefined ? dto.routeId : customer.routeId;

    if (targetSalesmanId || targetRouteId) {
      await this.validateCustomerSalesmanAndRoute(
        organizationId,
        targetSalesmanId,
        targetRouteId,
      );
    }

    const updated = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(dto.code && { code: dto.code.trim().toUpperCase() }),
        ...(dto.name && { name: dto.name.trim() }),
        ...(dto.customerType && { customerType: dto.customerType }),
        ...(dto.contactPerson !== undefined && {
          contactPerson: dto.contactPerson?.trim() || null,
        }),
        ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
        ...(dto.email !== undefined && { email: dto.email?.trim() || null }),
        ...(dto.address !== undefined && {
          address: dto.address?.trim() || null,
        }),
        ...(dto.city !== undefined && { city: dto.city?.trim() || null }),
        ...(dto.ntn !== undefined && { ntn: dto.ntn?.trim() || null }),
        ...(dto.strn !== undefined && { strn: dto.strn?.trim() || null }),
        ...(dto.drugSaleLicenseNo !== undefined && {
          drugSaleLicenseNo: dto.drugSaleLicenseNo?.trim() || null,
        }),
        ...(dto.creditDays !== undefined && { creditDays: dto.creditDays }),
        ...(dto.creditLimit !== undefined && {
          creditLimit: new Prisma.Decimal(dto.creditLimit),
        }),
        ...(dto.defaultDiscountPercentage !== undefined && {
          defaultDiscountPercentage: new Prisma.Decimal(
            dto.defaultDiscountPercentage,
          ),
        }),
        ...(dto.defaultSalesmanId !== undefined && {
          defaultSalesmanId: dto.defaultSalesmanId || null,
        }),
        ...(dto.routeId !== undefined && {
          routeId: dto.routeId || null,
        }),
        ...(dto.isTaxExempt !== undefined && {
          isTaxExempt: dto.isTaxExempt,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        defaultSalesman: { select: { id: true, name: true, code: true, phone: true } },
        route: { select: { id: true, name: true, code: true, city: true, area: true } },
      },
    });

    await this.audit.log({
      userId,
      action: 'UPDATE_CUSTOMER',
      entity: 'CUSTOMER',
      entityId: updated.id,
      details: { changes: dto },
    });

    return updated;
  }

  /**
   * Retrieves paginated list of customers.
   */
  async getCustomers(query: QueryCustomerDto) {
    const organizationId = await this.getOrganizationId();
    const { search, customerType, isActive, salesmanId, routeId, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      organizationId,
      ...(customerType && { customerType }),
      ...(isActive !== undefined && { isActive }),
      ...(salesmanId && { defaultSalesmanId: salesmanId }),
      ...(routeId && { routeId }),
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { code: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { contactPerson: { contains: search, mode: 'insensitive' } },
          { drugSaleLicenseNo: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ name: 'asc' }],
        include: {
          defaultSalesman: { select: { id: true, name: true, code: true, phone: true } },
          route: { select: { id: true, name: true, code: true, city: true, area: true } },
          _count: {
            select: {
              salesInvoices: true,
              ledgerEntries: true,
            },
          },
        },
      }),
      this.prisma.customer.count({ where }),
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
   * Retrieves customer details with summary statistics.
   */
  async getCustomerById(id: string) {
    const organizationId = await this.getOrganizationId();
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId },
      include: {
        defaultSalesman: { select: { id: true, name: true, code: true, phone: true } },
        route: { select: { id: true, name: true, code: true, city: true, area: true } },
        deliveryAddresses: {
          where: { isActive: true },
          include: {
            route: { select: { id: true, name: true, code: true, city: true, area: true } },
          },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        },
        _count: {
          select: {
            salesInvoices: true,
            ledgerEntries: true,
            pricingRules: true,
            deliveryAddresses: true,
          },
        },
        pricingRules: {
          include: {
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                genericName: true,
              },
            },
          },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${id}" not found`);
    }

    return customer;
  }

  /**
   * Retrieves customer sub-ledger statement with date filtering and running balances.
   */
  async getCustomerLedger(customerId: string, query: QueryCustomerLedgerDto) {
    const organizationId = await this.getOrganizationId();
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: {
        id: true,
        code: true,
        name: true,
        currentBalance: true,
        creditLimit: true,
        creditDays: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }

    const { startDate, endDate, entryType, branchId, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerLedgerEntryWhereInput = {
      organizationId,
      customerId,
      ...(entryType && { entryType }),
      ...(branchId && { branchId }),
      ...(startDate || endDate
        ? {
            transactionDate: {
              ...(startDate && { gte: new Date(startDate) }),
              ...(endDate && { lte: new Date(endDate) }),
            },
          }
        : {}),
    };

    const [items, total, aggregates] = await Promise.all([
      this.prisma.customerLedgerEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          branch: {
            select: { id: true, name: true, code: true },
          },
          createdByUser: {
            select: { id: true, displayName: true, username: true },
          },
          salesInvoice: {
            select: { id: true, invoiceNumber: true, netTotal: true },
          },
        },
      }),
      this.prisma.customerLedgerEntry.count({ where }),
      this.prisma.customerLedgerEntry.aggregate({
        where,
        _sum: {
          debit: true,
          credit: true,
        },
      }),
    ]);

    const totalDebit = Number(aggregates._sum.debit || 0);
    const totalCredit = Number(aggregates._sum.credit || 0);

    return {
      customer,
      summary: {
        totalDebit,
        totalCredit,
        netBalance: totalDebit - totalCredit,
      },
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
   * Retrieves customer-specific pricing rules.
   */
  async getCustomerPricing(customerId: string) {
    const organizationId = await this.getOrganizationId();
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }

    return this.prisma.customerPricingRule.findMany({
      where: { customerId, organizationId },
      include: {
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
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Upserts a customer-specific pricing override for a product.
   */
  async upsertCustomerPricing(
    customerId: string,
    dto: UpsertCustomerPricingRuleDto,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();
    const [customer, product] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: customerId, organizationId },
      }),
      this.prisma.product.findFirst({
        where: { id: dto.productId, organizationId },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }
    if (!product) {
      throw new NotFoundException(`Product with ID "${dto.productId}" not found`);
    }

    if (dto.customPrice === undefined && dto.discountPercentage === undefined) {
      throw new BadRequestException(
        'Either customPrice or discountPercentage must be provided',
      );
    }

    let rule = await this.prisma.customerPricingRule.findFirst({
      where: {
        organizationId,
        customerId,
        productId: dto.productId,
      },
    });

    if (rule) {
      rule = await this.prisma.customerPricingRule.update({
        where: { id: rule.id },
        data: {
          ...(dto.customPrice !== undefined && {
            customPrice: new Prisma.Decimal(dto.customPrice),
          }),
          ...(dto.discountPercentage !== undefined && {
            discountPercentage: new Prisma.Decimal(dto.discountPercentage),
          }),
          ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        },
      });
    } else {
      rule = await this.prisma.customerPricingRule.create({
        data: {
          organizationId,
          customerId,
          productId: dto.productId,
          customPrice:
            dto.customPrice !== undefined
              ? new Prisma.Decimal(dto.customPrice)
              : null,
          discountPercentage:
            dto.discountPercentage !== undefined
              ? new Prisma.Decimal(dto.discountPercentage)
              : null,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
      });
    }

    await this.audit.log({
      userId,
      action: 'UPSERT_CUSTOMER_PRICING',
      entity: 'CUSTOMER_PRICING_RULE',
      entityId: rule.id,
      details: { customerId, productId: dto.productId, dto },
    });

    return rule;
  }

  // =========================================================================
  // CUSTOMER DELIVERY ADDRESSES
  // =========================================================================

  /**
   * Helper: Validates delivery address route against organization.
   */
  private async validateCustomerAddressRoute(
    organizationId: string,
    customerId: string,
    routeId?: string | null,
  ) {
    if (!routeId) return;

    const route = await this.prisma.salesRoute.findFirst({
      where: { id: routeId, organizationId },
      select: { id: true, name: true, branchId: true },
    });

    if (!route) {
      throw new BadRequestException(
        `Sales route with ID "${routeId}" does not exist in this organization.`,
      );
    }
  }

  /**
   * Retrieves all delivery addresses for a customer.
   */
  async getCustomerAddresses(customerId: string, query?: QueryCustomerAddressDto) {
    const organizationId = await this.getOrganizationId();
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }

    const { search, isActive, city, routeId } = query || {};

    const where: Prisma.CustomerDeliveryAddressWhereInput = {
      organizationId,
      customerId,
      ...(isActive !== undefined && { isActive }),
      ...(city && { city: { contains: city, mode: 'insensitive' } }),
      ...(routeId && { routeId }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { recipientName: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { city: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    return this.prisma.customerDeliveryAddress.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      include: {
        route: { select: { id: true, name: true, code: true, city: true, area: true } },
      },
    });
  }

  /**
   * Retrieves a single customer delivery address by ID.
   */
  async getCustomerAddressById(customerId: string, addressId: string) {
    const organizationId = await this.getOrganizationId();
    const address = await this.prisma.customerDeliveryAddress.findFirst({
      where: { id: addressId, customerId, organizationId },
      include: {
        route: { select: { id: true, name: true, code: true, city: true, area: true } },
      },
    });

    if (!address) {
      throw new NotFoundException(
        `Delivery address with ID "${addressId}" not found for customer "${customerId}"`,
      );
    }

    return address;
  }

  /**
   * Creates a new delivery address for a customer.
   */
  async createCustomerAddress(
    customerId: string,
    dto: CreateCustomerAddressDto,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID "${customerId}" not found`);
    }

    if (customer.customerType === 'WALK_IN') {
      throw new BadRequestException('Walk-in cash customers cannot have delivery addresses.');
    }

    if (dto.routeId) {
      await this.validateCustomerAddressRoute(organizationId, customerId, dto.routeId);
    }

    const isActive = dto.isActive !== undefined ? dto.isActive : true;
    const isDefault = dto.isDefault === true;

    if (isDefault && !isActive) {
      throw new BadRequestException('An inactive delivery address cannot be set as default.');
    }

    return this.prisma.$transaction(async (tx) => {
      if (isDefault) {
        // Atomic unset of existing default
        await tx.customerDeliveryAddress.updateMany({
          where: { customerId, organizationId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.customerDeliveryAddress.create({
        data: {
          organizationId,
          customerId,
          title: dto.title.trim(),
          recipientName: dto.recipientName?.trim() || null,
          phone: dto.phone?.trim() || null,
          address: dto.address.trim(),
          city: dto.city?.trim() || null,
          routeId: dto.routeId || null,
          deliveryInstructions: dto.deliveryInstructions?.trim() || null,
          isDefault,
          isActive,
        },
        include: {
          route: { select: { id: true, name: true, code: true, city: true, area: true } },
        },
      });

      await this.audit.log({
        userId,
        action: 'CREATE_CUSTOMER_DELIVERY_ADDRESS',
        entity: 'CUSTOMER_DELIVERY_ADDRESS',
        entityId: created.id,
        details: { customerId, dto },
      });

      return created;
    });
  }

  /**
   * Updates an existing customer delivery address.
   */
  async updateCustomerAddress(
    customerId: string,
    addressId: string,
    dto: UpdateCustomerAddressDto,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();
    const existing = await this.prisma.customerDeliveryAddress.findFirst({
      where: { id: addressId, customerId, organizationId },
    });

    if (!existing) {
      throw new NotFoundException(
        `Delivery address with ID "${addressId}" not found for customer "${customerId}"`,
      );
    }

    if (dto.routeId) {
      await this.validateCustomerAddressRoute(organizationId, customerId, dto.routeId);
    }

    const newActive = dto.isActive !== undefined ? dto.isActive : existing.isActive;
    let newDefault = dto.isDefault !== undefined ? dto.isDefault : existing.isDefault;

    // Rule: Deactivating an address automatically makes isDefault = false (leaves customer with no default)
    if (!newActive) {
      if (dto.isDefault === true) {
        throw new BadRequestException('An inactive delivery address cannot be set as default.');
      }
      newDefault = false;
    }

    return this.prisma.$transaction(async (tx) => {
      if (newDefault && !existing.isDefault) {
        // Atomic unset of other defaults
        await tx.customerDeliveryAddress.updateMany({
          where: {
            customerId,
            organizationId,
            id: { not: addressId },
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      const updated = await tx.customerDeliveryAddress.update({
        where: { id: addressId },
        data: {
          ...(dto.title !== undefined && { title: dto.title.trim() }),
          ...(dto.recipientName !== undefined && { recipientName: dto.recipientName?.trim() || null }),
          ...(dto.phone !== undefined && { phone: dto.phone?.trim() || null }),
          ...(dto.address !== undefined && { address: dto.address.trim() }),
          ...(dto.city !== undefined && { city: dto.city?.trim() || null }),
          ...(dto.routeId !== undefined && { routeId: dto.routeId || null }),
          ...(dto.deliveryInstructions !== undefined && {
            deliveryInstructions: dto.deliveryInstructions?.trim() || null,
          }),
          ...(dto.isDefault !== undefined || !newActive ? { isDefault: newDefault } : {}),
          ...(dto.isActive !== undefined && { isActive: newActive }),
        },
        include: {
          route: { select: { id: true, name: true, code: true, city: true, area: true } },
        },
      });

      await this.audit.log({
        userId,
        action: 'UPDATE_CUSTOMER_DELIVERY_ADDRESS',
        entity: 'CUSTOMER_DELIVERY_ADDRESS',
        entityId: updated.id,
        details: { customerId, changes: dto },
      });

      return updated;
    });
  }

  /**
   * Sets a delivery address as default for a customer.
   */
  async setDefaultCustomerAddress(
    customerId: string,
    addressId: string,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();
    const address = await this.prisma.customerDeliveryAddress.findFirst({
      where: { id: addressId, customerId, organizationId },
    });

    if (!address) {
      throw new NotFoundException(
        `Delivery address with ID "${addressId}" not found for customer "${customerId}"`,
      );
    }

    if (!address.isActive) {
      throw new BadRequestException('Cannot set an inactive delivery address as default.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.customerDeliveryAddress.updateMany({
        where: { customerId, organizationId, isDefault: true },
        data: { isDefault: false },
      });

      const updated = await tx.customerDeliveryAddress.update({
        where: { id: addressId },
        data: { isDefault: true },
        include: {
          route: { select: { id: true, name: true, code: true, city: true, area: true } },
        },
      });

      await this.audit.log({
        userId,
        action: 'SET_DEFAULT_CUSTOMER_DELIVERY_ADDRESS',
        entity: 'CUSTOMER_DELIVERY_ADDRESS',
        entityId: addressId,
        details: { customerId },
      });

      return updated;
    });
  }

  /**
   * Deletes or soft-deactivates a customer delivery address.
   */
  async deleteCustomerAddress(
    customerId: string,
    addressId: string,
    userId?: string,
  ) {
    const organizationId = await this.getOrganizationId();
    const address = await this.prisma.customerDeliveryAddress.findFirst({
      where: { id: addressId, customerId, organizationId },
    });

    if (!address) {
      throw new NotFoundException(
        `Delivery address with ID "${addressId}" not found for customer "${customerId}"`,
      );
    }

    // Check if referenced in SalesInvoice
    const referenceCount = await this.prisma.salesInvoice.count({
      where: { deliveryAddressId: addressId },
    });

    if (referenceCount > 0) {
      // Soft-deactivate to protect relational history
      const deactivated = await this.prisma.customerDeliveryAddress.update({
        where: { id: addressId },
        data: { isActive: false, isDefault: false },
      });

      await this.audit.log({
        userId,
        action: 'DEACTIVATE_CUSTOMER_DELIVERY_ADDRESS',
        entity: 'CUSTOMER_DELIVERY_ADDRESS',
        entityId: addressId,
        details: { customerId, reason: 'Referenced by sales invoices, soft-deactivated.' },
      });

      return {
        message: 'Delivery address is referenced by invoices and has been deactivated.',
        address: deactivated,
        softDeleted: true,
      };
    }

    // Safe to hard delete if unreferenced
    await this.prisma.customerDeliveryAddress.delete({
      where: { id: addressId },
    });

    await this.audit.log({
      userId,
      action: 'DELETE_CUSTOMER_DELIVERY_ADDRESS',
      entity: 'CUSTOMER_DELIVERY_ADDRESS',
      entityId: addressId,
      details: { customerId },
    });

    return {
      message: 'Delivery address deleted successfully.',
      softDeleted: false,
    };
  }
}
