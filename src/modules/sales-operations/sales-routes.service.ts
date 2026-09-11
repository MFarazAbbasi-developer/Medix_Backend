import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateSalesRouteDto,
  UpdateSalesRouteDto,
  QuerySalesRouteDto,
} from './dto/sales-route.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class SalesRoutesService {
  private readonly logger = new Logger(SalesRoutesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * List sales routes with search, city, area, branch, salesman, and active filters.
   */
  async getRoutes(query: QuerySalesRouteDto, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.SalesRouteWhereInput = {
      organizationId: orgId,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.city) {
      where.city = { contains: query.city.trim(), mode: 'insensitive' };
    }

    if (query.area) {
      where.area = { contains: query.area.trim(), mode: 'insensitive' };
    }

    if (query.branchId) {
      where.OR = [
        { branchId: query.branchId },
        { branchId: null },
      ];
    }

    if (query.salesmanId) {
      where.salesmen = {
        some: {
          salesmanId: query.salesmanId,
        },
      };
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
        { area: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.salesRoute.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          salesmen: {
            include: {
              salesman: {
                select: { id: true, name: true, code: true, phone: true, email: true, isActive: true },
              },
            },
          },
          _count: {
            select: {
              customers: true,
              salesInvoices: true,
            },
          },
        },
      }),
      this.prisma.salesRoute.count({ where }),
    ]);

    return {
      items: items.map((r) => ({
        ...r,
        assignedSalesmen: r.salesmen.map((s) => s.salesman),
        customerCount: r._count.customers,
        invoiceCount: r._count.salesInvoices,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Get single sales route by ID.
   */
  async getRouteById(id: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());

    const route = await this.prisma.salesRoute.findFirst({
      where: { id, organizationId: orgId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        salesmen: {
          include: {
            salesman: true,
          },
        },
        _count: {
          select: {
            customers: true,
            salesInvoices: true,
          },
        },
      },
    });

    if (!route) {
      throw new NotFoundException(`Sales route with ID "${id}" not found.`);
    }

    return {
      ...route,
      assignedSalesmen: route.salesmen.map((s) => s.salesman),
      customerCount: route._count.customers,
      invoiceCount: route._count.salesInvoices,
    };
  }

  /**
   * Create a new Sales Route.
   */
  async createRoute(dto: CreateSalesRouteDto, userId?: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const code = dto.code.trim().toUpperCase();

    // 1. Check duplicate code
    const existing = await this.prisma.salesRoute.findUnique({
      where: { organizationId_code: { organizationId: orgId, code } },
    });
    if (existing) {
      throw new ConflictException(`Sales route code "${code}" already exists in this organization.`);
    }

    // 2. Validate branch if provided
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId: orgId },
      });
      if (!branch) {
        throw new BadRequestException(`Branch with ID "${dto.branchId}" does not exist.`);
      }
    }

    // 3. Validate assigned salesmen
    if (dto.salesmanIds && dto.salesmanIds.length > 0) {
      await this.validateSalesmanIds(dto.salesmanIds, orgId, dto.branchId);
    }

    // 4. Create in transaction
    const created = await this.prisma.$transaction(async (tx) => {
      const route = await tx.salesRoute.create({
        data: {
          organizationId: orgId,
          branchId: dto.branchId || null,
          code,
          name: dto.name.trim(),
          city: dto.city?.trim() || null,
          area: dto.area?.trim() || null,
          notes: dto.notes?.trim() || null,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
      });

      if (dto.salesmanIds && dto.salesmanIds.length > 0) {
        const salesmanData = dto.salesmanIds.map((salesmanId) => ({
          salesmanId,
          routeId: route.id,
        }));
        await tx.salesmanRoute.createMany({
          data: salesmanData,
          skipDuplicates: true,
        });
      }

      return route;
    });

    if (userId) {
      await this.auditService.log({
        userId,
        action: 'CREATE',
        entity: 'SalesRoute',
        entityId: created.id,
        details: { code: created.code, name: created.name, salesmen: dto.salesmanIds },
      });
    }

    return this.getRouteById(created.id, orgId);
  }

  /**
   * Update an existing sales route.
   */
  async updateRoute(id: string, dto: UpdateSalesRouteDto, userId?: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const existing = await this.prisma.salesRoute.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException(`Sales route with ID "${id}" not found.`);
    }

    // Check code uniqueness if changing
    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      const newCode = dto.code.trim().toUpperCase();
      const duplicate = await this.prisma.salesRoute.findUnique({
        where: { organizationId_code: { organizationId: orgId, code: newCode } },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`Sales route code "${newCode}" already exists.`);
      }
    }

    const targetBranchId = dto.branchId !== undefined ? dto.branchId : existing.branchId;

    if (targetBranchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: targetBranchId, organizationId: orgId },
      });
      if (!branch) {
        throw new BadRequestException(`Branch with ID "${targetBranchId}" does not exist.`);
      }
    }

    if (dto.salesmanIds && dto.salesmanIds.length > 0) {
      await this.validateSalesmanIds(dto.salesmanIds, orgId, targetBranchId || undefined);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.salesRoute.update({
        where: { id },
        data: {
          code: dto.code ? dto.code.trim().toUpperCase() : undefined,
          name: dto.name ? dto.name.trim() : undefined,
          city: dto.city !== undefined ? dto.city?.trim() || null : undefined,
          area: dto.area !== undefined ? dto.area?.trim() || null : undefined,
          branchId: dto.branchId !== undefined ? (dto.branchId || null) : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
          isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        },
      });

      if (dto.salesmanIds !== undefined) {
        await tx.salesmanRoute.deleteMany({ where: { routeId: id } });
        if (dto.salesmanIds.length > 0) {
          await tx.salesmanRoute.createMany({
            data: dto.salesmanIds.map((salesmanId) => ({
              salesmanId,
              routeId: id,
            })),
            skipDuplicates: true,
          });
        }
      }
    });

    if (userId) {
      await this.auditService.log({
        userId,
        action: 'UPDATE',
        entity: 'SalesRoute',
        entityId: id,
        details: { changes: dto },
      });
    }

    return this.getRouteById(id, orgId);
  }

  /**
   * Delete or deactivate a sales route safely.
   */
  async deleteRoute(id: string, userId?: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const route = await this.prisma.salesRoute.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: {
          select: {
            customers: true,
            salesInvoices: true,
          },
        },
      },
    });

    if (!route) {
      throw new NotFoundException(`Sales route with ID "${id}" not found.`);
    }

    const isReferenced = route._count.customers > 0 || route._count.salesInvoices > 0;

    if (isReferenced) {
      await this.prisma.salesRoute.update({
        where: { id },
        data: { isActive: false },
      });

      if (userId) {
        await this.auditService.log({
          userId,
          action: 'DEACTIVATE',
          entity: 'SalesRoute',
          entityId: id,
          details: { reason: 'Deactivated due to customer/invoice references' },
        });
      }

      return {
        success: true,
        message: `Sales route "${route.name}" has existing customer/invoice records and has been deactivated.`,
        deactivated: true,
      };
    }

    await this.prisma.salesRoute.delete({ where: { id } });

    if (userId) {
      await this.auditService.log({
        userId,
        action: 'DELETE',
        entity: 'SalesRoute',
        entityId: id,
        details: { code: route.code, name: route.name },
      });
    }

    return {
      success: true,
      message: `Sales route "${route.name}" deleted successfully.`,
      deactivated: false,
    };
  }

  /**
   * Helper: Validate salesman IDs exist in organization and are branch-compatible.
   */
  private async validateSalesmanIds(salesmanIds: string[], organizationId: string, routeBranchId?: string) {
    const salesmen = await this.prisma.salesman.findMany({
      where: {
        id: { in: salesmanIds },
        organizationId,
      },
    });

    if (salesmen.length !== salesmanIds.length) {
      throw new BadRequestException('One or more selected salesmen do not exist in this organization.');
    }

    if (routeBranchId) {
      for (const s of salesmen) {
        if (s.branchId && s.branchId !== routeBranchId) {
          throw new BadRequestException(
            `Salesman "${s.name}" belongs to a different branch and cannot be assigned to this branch-specific route.`,
          );
        }
      }
    }
  }

  private async getDefaultOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new BadRequestException('No organization initialized in system.');
    }
    return org.id;
  }
}
