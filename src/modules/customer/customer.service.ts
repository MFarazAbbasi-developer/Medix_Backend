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
          isTaxExempt: dto.isTaxExempt ?? false,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
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
        ...(dto.isTaxExempt !== undefined && {
          isTaxExempt: dto.isTaxExempt,
        }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
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
    const { search, customerType, isActive, page = 1, limit = 50 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      organizationId,
      ...(customerType && { customerType }),
      ...(isActive !== undefined && { isActive }),
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
        _count: {
          select: {
            salesInvoices: true,
            ledgerEntries: true,
            pricingRules: true,
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
}
