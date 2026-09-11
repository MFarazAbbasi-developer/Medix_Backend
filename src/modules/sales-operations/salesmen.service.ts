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
  CreateSalesmanDto,
  UpdateSalesmanDto,
  QuerySalesmanDto,
} from './dto/salesman.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class SalesmenService {
  private readonly logger = new Logger(SalesmenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * List salesmen with search, branch, route, and active filters.
   */
  async getSalesmen(query: QuerySalesmanDto, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.SalesmanWhereInput = {
      organizationId: orgId,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.branchId) {
      where.OR = [
        { branchId: query.branchId },
        { branchId: null }, // Org-wide salesmen are available across branches
      ];
    }

    if (query.routeId) {
      where.routes = {
        some: {
          routeId: query.routeId,
        },
      };
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.salesman.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
        include: {
          branch: { select: { id: true, name: true, code: true } },
          routes: {
            include: {
              route: {
                select: { id: true, name: true, code: true, city: true, area: true, isActive: true },
              },
            },
          },
          _count: {
            select: {
              defaultForCustomers: true,
              salesInvoices: true,
            },
          },
        },
      }),
      this.prisma.salesman.count({ where }),
    ]);

    return {
      items: items.map((sm) => ({
        ...sm,
        assignedRoutes: sm.routes.map((r) => r.route),
        customerCount: sm._count.defaultForCustomers,
        invoiceCount: sm._count.salesInvoices,
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
   * Get single salesman by ID.
   */
  async getSalesmanById(id: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());

    const salesman = await this.prisma.salesman.findFirst({
      where: { id, organizationId: orgId },
      include: {
        branch: { select: { id: true, name: true, code: true } },
        routes: {
          include: {
            route: true,
          },
        },
        _count: {
          select: {
            defaultForCustomers: true,
            salesInvoices: true,
          },
        },
      },
    });

    if (!salesman) {
      throw new NotFoundException(`Salesman with ID "${id}" not found.`);
    }

    return {
      ...salesman,
      assignedRoutes: salesman.routes.map((r) => r.route),
      customerCount: salesman._count.defaultForCustomers,
      invoiceCount: salesman._count.salesInvoices,
    };
  }

  /**
   * Create a new Salesman and link initial route assignments.
   */
  async createSalesman(dto: CreateSalesmanDto, userId?: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const code = dto.code.trim().toUpperCase();

    // 1. Check duplicate code
    const existing = await this.prisma.salesman.findUnique({
      where: { organizationId_code: { organizationId: orgId, code } },
    });
    if (existing) {
      throw new ConflictException(`Salesman code "${code}" already exists in this organization.`);
    }

    // 2. Validate branch if provided
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: dto.branchId, organizationId: orgId },
      });
      if (!branch) {
        throw new BadRequestException(`Branch with ID "${dto.branchId}" does not exist in this organization.`);
      }
    }

    // 3. Validate assigned routes
    if (dto.routeIds && dto.routeIds.length > 0) {
      await this.validateRouteIds(dto.routeIds, orgId, dto.branchId);
    }

    // 4. Create in transaction
    const created = await this.prisma.$transaction(async (tx) => {
      const salesman = await tx.salesman.create({
        data: {
          organizationId: orgId,
          branchId: dto.branchId || null,
          code,
          name: dto.name.trim(),
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          notes: dto.notes?.trim() || null,
          isActive: dto.isActive !== undefined ? dto.isActive : true,
        },
      });

      if (dto.routeIds && dto.routeIds.length > 0) {
        const routeData = dto.routeIds.map((routeId) => ({
          salesmanId: salesman.id,
          routeId,
        }));
        await tx.salesmanRoute.createMany({
          data: routeData,
          skipDuplicates: true,
        });
      }

      return salesman;
    });

    if (userId) {
      await this.auditService.log({
        userId,
        action: 'CREATE',
        entity: 'Salesman',
        entityId: created.id,
        details: { code: created.code, name: created.name, routes: dto.routeIds },
      });
    }

    return this.getSalesmanById(created.id, orgId);
  }

  /**
   * Update an existing salesman and synchronize route assignments.
   */
  async updateSalesman(id: string, dto: UpdateSalesmanDto, userId?: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const existing = await this.prisma.salesman.findFirst({
      where: { id, organizationId: orgId },
    });

    if (!existing) {
      throw new NotFoundException(`Salesman with ID "${id}" not found.`);
    }

    // Check code uniqueness if changing
    if (dto.code && dto.code.trim().toUpperCase() !== existing.code) {
      const newCode = dto.code.trim().toUpperCase();
      const duplicate = await this.prisma.salesman.findUnique({
        where: { organizationId_code: { organizationId: orgId, code: newCode } },
      });
      if (duplicate && duplicate.id !== id) {
        throw new ConflictException(`Salesman code "${newCode}" already exists.`);
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

    if (dto.routeIds && dto.routeIds.length > 0) {
      await this.validateRouteIds(dto.routeIds, orgId, targetBranchId || undefined);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.salesman.update({
        where: { id },
        data: {
          code: dto.code ? dto.code.trim().toUpperCase() : undefined,
          name: dto.name ? dto.name.trim() : undefined,
          phone: dto.phone !== undefined ? dto.phone?.trim() || null : undefined,
          email: dto.email !== undefined ? dto.email?.trim() || null : undefined,
          branchId: dto.branchId !== undefined ? (dto.branchId || null) : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
          isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        },
      });

      if (dto.routeIds !== undefined) {
        // Replace route links
        await tx.salesmanRoute.deleteMany({ where: { salesmanId: id } });
        if (dto.routeIds.length > 0) {
          await tx.salesmanRoute.createMany({
            data: dto.routeIds.map((routeId) => ({
              salesmanId: id,
              routeId,
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
        entity: 'Salesman',
        entityId: id,
        details: { changes: dto },
      });
    }

    return this.getSalesmanById(id, orgId);
  }

  /**
   * Delete or deactivate a salesman safely.
   */
  async deleteSalesman(id: string, userId?: string, organizationId?: string) {
    const orgId = organizationId || (await this.getDefaultOrganizationId());
    const salesman = await this.prisma.salesman.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: {
          select: {
            defaultForCustomers: true,
            salesInvoices: true,
          },
        },
      },
    });

    if (!salesman) {
      throw new NotFoundException(`Salesman with ID "${id}" not found.`);
    }

    const isReferenced = salesman._count.defaultForCustomers > 0 || salesman._count.salesInvoices > 0;

    if (isReferenced) {
      // Soft-deactivate if referenced by transaction history or customer defaults
      await this.prisma.salesman.update({
        where: { id },
        data: { isActive: false },
      });

      if (userId) {
        await this.auditService.log({
          userId,
          action: 'DEACTIVATE',
          entity: 'Salesman',
          entityId: id,
          details: { reason: 'Deactivated due to historical references' },
        });
      }

      return {
        success: true,
        message: `Salesman "${salesman.name}" has existing customer/invoice records and has been deactivated.`,
        deactivated: true,
      };
    }

    // Physically delete if unreferenced
    await this.prisma.salesman.delete({ where: { id } });

    if (userId) {
      await this.auditService.log({
        userId,
        action: 'DELETE',
        entity: 'Salesman',
        entityId: id,
        details: { code: salesman.code, name: salesman.name },
      });
    }

    return {
      success: true,
      message: `Salesman "${salesman.name}" deleted successfully.`,
      deactivated: false,
    };
  }

  /**
   * Helper: Validate route IDs exist in organization and are branch-compatible.
   */
  private async validateRouteIds(routeIds: string[], organizationId: string, salesmanBranchId?: string) {
    const routes = await this.prisma.salesRoute.findMany({
      where: {
        id: { in: routeIds },
        organizationId,
      },
    });

    if (routes.length !== routeIds.length) {
      throw new BadRequestException('One or more selected routes do not exist in this organization.');
    }

    // Branch compatibility check: If salesman is bound to a branch, route must be in that branch or org-wide
    if (salesmanBranchId) {
      for (const r of routes) {
        if (r.branchId && r.branchId !== salesmanBranchId) {
          throw new BadRequestException(
            `Route "${r.name}" belongs to a different branch and cannot be assigned to this branch-specific salesman.`,
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
