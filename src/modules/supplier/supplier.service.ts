import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { QuerySupplierLedgerDto } from './dto/query-ledger.dto';
import { Prisma, SupplierLedgerEntryType } from '@prisma/client';

@Injectable()
export class SupplierService {
  private readonly logger = new Logger(SupplierService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async getOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }
    return org.id;
  }

  /**
   * Creates a new supplier master profile.
   * If openingBalance > 0, initializes an OPENING_BALANCE ledger entry atomically.
   */
  async create(dto: CreateSupplierDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const code = dto.code.trim().toUpperCase();

    const existingCode = await this.prisma.supplier.findUnique({
      where: {
        organizationId_code: {
          organizationId: orgId,
          code,
        },
      },
    });

    if (existingCode) {
      throw new ConflictException(`Supplier with code "${code}" already exists`);
    }

    const openingBalance = dto.openingBalance ? Math.max(0, Number(dto.openingBalance)) : 0;

    return this.prisma.$transaction(async (tx) => {
      // 1. Create supplier with initial balance
      const supplier = await tx.supplier.create({
        data: {
          organizationId: orgId,
          code,
          name: dto.name.trim(),
          contactPerson: dto.contactPerson?.trim() || null,
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          address: dto.address?.trim() || null,
          city: dto.city?.trim() || null,
          ntn: dto.ntn?.trim() || null,
          strn: dto.strn?.trim() || null,
          drugLicenseNo: dto.drugLicenseNo?.trim() || null,
          creditDays: dto.creditDays !== undefined ? dto.creditDays : 30,
          creditLimit: new Prisma.Decimal(dto.creditLimit !== undefined ? dto.creditLimit : 0),
          currentBalance: new Prisma.Decimal(openingBalance),
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
      });

      // 2. If opening balance provided, record as financial ledger entry
      if (openingBalance > 0) {
        const headOfficeBranch = await tx.branch.findFirst({
          where: { organizationId: orgId, isHeadOffice: true },
        });
        const branchId = headOfficeBranch
          ? headOfficeBranch.id
          : (await tx.branch.findFirst({ where: { organizationId: orgId } }))?.id;

        if (branchId) {
          await tx.supplierLedgerEntry.create({
            data: {
              organizationId: orgId,
              branchId,
              supplierId: supplier.id,
              entryType: SupplierLedgerEntryType.OPENING_BALANCE,
              referenceNumber: 'OPENING',
              debit: new Prisma.Decimal(0),
              credit: new Prisma.Decimal(openingBalance),
              runningBalance: new Prisma.Decimal(openingBalance),
              notes: 'Initial opening balance recorded at supplier setup',
              createdByUserId: userId,
            },
          });
        }
      }

      await this.auditService.log({
        userId,
        action: 'CREATE_SUPPLIER',
        entity: 'SUPPLIER',
        entityId: supplier.id,
        details: {
          code: supplier.code,
          name: supplier.name,
          openingBalance,
          creditDays: supplier.creditDays,
        },
      });

      return supplier;
    });
  }

  /**
   * Retrieves paginated supplier directory with flexible search and filtering.
   */
  async findAll(query: QuerySupplierDto) {
    const orgId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierWhereInput = {
      organizationId: orgId,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { code: { contains: term, mode: 'insensitive' } },
        { contactPerson: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { ntn: { contains: term, mode: 'insensitive' } },
        { strn: { contains: term, mode: 'insensitive' } },
        { city: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.supplier.count({ where }),
      this.prisma.supplier.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              purchaseOrders: true,
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
   * Retrieves a single supplier by ID with metrics.
   */
  async findById(id: string) {
    const orgId = await this.getOrganizationId();
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: {
          select: {
            purchaseOrders: true,
            goodsReceiveNotes: true,
            ledgerEntries: true,
          },
        },
      },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${id}" not found`);
    }

    return supplier;
  }

  /**
   * Updates an existing supplier master record.
   */
  async update(id: string, dto: UpdateSupplierDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const supplier = await this.prisma.supplier.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${id}" not found`);
    }

    if (dto.code && dto.code.trim().toUpperCase() !== supplier.code) {
      const newCode = dto.code.trim().toUpperCase();
      const existing = await this.prisma.supplier.findUnique({
        where: {
          organizationId_code: {
            organizationId: orgId,
            code: newCode,
          },
        },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(`Supplier with code "${newCode}" already exists`);
      }
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: {
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        name: dto.name ? dto.name.trim() : undefined,
        contactPerson: dto.contactPerson !== undefined ? dto.contactPerson?.trim() || null : undefined,
        phone: dto.phone !== undefined ? dto.phone?.trim() || null : undefined,
        email: dto.email !== undefined ? dto.email?.trim() || null : undefined,
        address: dto.address !== undefined ? dto.address?.trim() || null : undefined,
        city: dto.city !== undefined ? dto.city?.trim() || null : undefined,
        ntn: dto.ntn !== undefined ? dto.ntn?.trim() || null : undefined,
        strn: dto.strn !== undefined ? dto.strn?.trim() || null : undefined,
        drugLicenseNo: dto.drugLicenseNo !== undefined ? dto.drugLicenseNo?.trim() || null : undefined,
        creditDays: dto.creditDays !== undefined ? dto.creditDays : undefined,
        creditLimit:
          dto.creditLimit !== undefined
            ? new Prisma.Decimal(dto.creditLimit)
            : undefined,
        isActive: dto.isActive !== undefined ? dto.isActive : undefined,
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_SUPPLIER',
      entity: 'SUPPLIER',
      entityId: id,
      details: {
        code: updated.code,
        name: updated.name,
        changes: Object.keys(dto),
      },
    });

    return updated;
  }

  /**
   * Retrieves supplier ledger statement with chronological running balances.
   */
  async getLedger(supplierId: string, query: QuerySupplierLedgerDto) {
    const orgId = await this.getOrganizationId();
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, organizationId: orgId },
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with ID "${supplierId}" not found`);
    }

    const page = query.page || 1;
    const limit = query.limit || 100;
    const skip = (page - 1) * limit;

    const where: Prisma.SupplierLedgerEntryWhereInput = {
      organizationId: orgId,
      supplierId,
    };

    if (query.entryType) {
      where.entryType = query.entryType;
    }

    if (query.branchId) {
      where.branchId = query.branchId;
    }

    if (query.startDate || query.endDate) {
      where.transactionDate = {};
      if (query.startDate) {
        where.transactionDate.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        const end = new Date(query.endDate);
        end.setHours(23, 59, 59, 999);
        where.transactionDate.lte = end;
      }
    }

    const [total, items, totals] = await Promise.all([
      this.prisma.supplierLedgerEntry.count({ where }),
      this.prisma.supplierLedgerEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          createdByUser: { select: { id: true, displayName: true, username: true } },
          grn: { select: { id: true, grnNumber: true, supplierInvoiceNumber: true } },
        },
      }),
      this.prisma.supplierLedgerEntry.aggregate({
        where,
        _sum: {
          debit: true,
          credit: true,
        },
      }),
    ]);

    return {
      supplier: {
        id: supplier.id,
        code: supplier.code,
        name: supplier.name,
        currentBalance: supplier.currentBalance,
        creditLimit: supplier.creditLimit,
        creditDays: supplier.creditDays,
      },
      summary: {
        totalDebit: totals._sum.debit || new Prisma.Decimal(0),
        totalCredit: totals._sum.credit || new Prisma.Decimal(0),
        netBalance: supplier.currentBalance,
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
}
