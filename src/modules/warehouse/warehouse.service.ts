import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class WarehouseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Retrieves warehouses for the organization, optionally filtered by branch.
   */
  async getWarehouses(branchId?: string, includeInactive = false) {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }

    const where: Prisma.WarehouseWhereInput = {
      organizationId: org.id,
    };

    if (branchId) {
      where.branchId = branchId;
    }

    if (!includeInactive) {
      where.isActive = true;
    }

    return this.prisma.warehouse.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });
  }

  /**
   * Retrieves a single warehouse by ID.
   */
  async getWarehouseById(id: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID "${id}" not found`);
    }

    return warehouse;
  }

  /**
   * Creates a new warehouse storage location.
   */
  async createWarehouse(dto: CreateWarehouseDto, userId?: string) {
    const org = await this.prisma.organization.findFirst();
    if (!org) {
      throw new NotFoundException('Organization profile not found');
    }

    // Verify branch exists in organization
    const branch = await this.prisma.branch.findFirst({
      where: { id: dto.branchId, organizationId: org.id },
    });

    if (!branch) {
      throw new BadRequestException(`Branch with ID "${dto.branchId}" does not exist in organization`);
    }

    // Check duplicate code in branch
    const existing = await this.prisma.warehouse.findUnique({
      where: {
        branchId_code: {
          branchId: dto.branchId,
          code: dto.code.toUpperCase().trim(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(`Warehouse with code "${dto.code}" already exists in this branch`);
    }

    return this.prisma.$transaction(async (tx) => {
      // If setting as default, unset other defaults in this branch
      if (dto.isDefault) {
        await tx.warehouse.updateMany({
          where: { branchId: dto.branchId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.warehouse.create({
        data: {
          organizationId: org.id,
          branchId: dto.branchId,
          name: dto.name.trim(),
          code: dto.code.toUpperCase().trim(),
          address: dto.address?.trim(),
          isDefault: dto.isDefault ?? false,
          isActive: dto.isActive ?? true,
        },
        include: {
          branch: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      await this.auditService.log({
        userId,
        action: 'CREATE_WAREHOUSE',
        entity: 'WAREHOUSE',
        entityId: created.id,
        details: { name: created.name, code: created.code, branchId: created.branchId },
      });

      return created;
    });
  }

  /**
   * Updates an existing warehouse location.
   */
  async updateWarehouse(id: string, dto: UpdateWarehouseDto, userId?: string) {
    const warehouse = await this.prisma.warehouse.findUnique({
      where: { id },
    });

    if (!warehouse) {
      throw new NotFoundException(`Warehouse with ID "${id}" not found`);
    }

    if (dto.code && dto.code.toUpperCase().trim() !== warehouse.code) {
      const existing = await this.prisma.warehouse.findUnique({
        where: {
          branchId_code: {
            branchId: warehouse.branchId,
            code: dto.code.toUpperCase().trim(),
          },
        },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(`Warehouse code "${dto.code}" is already in use in this branch`);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.warehouse.updateMany({
          where: { branchId: warehouse.branchId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
      }

      const updated = await tx.warehouse.update({
        where: { id },
        data: {
          name: dto.name ? dto.name.trim() : undefined,
          code: dto.code ? dto.code.toUpperCase().trim() : undefined,
          address: dto.address !== undefined ? dto.address?.trim() : undefined,
          isDefault: dto.isDefault !== undefined ? dto.isDefault : undefined,
          isActive: dto.isActive !== undefined ? dto.isActive : undefined,
        },
        include: {
          branch: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      await this.auditService.log({
        userId,
        action: 'UPDATE_WAREHOUSE',
        entity: 'WAREHOUSE',
        entityId: updated.id,
        details: { changes: dto },
      });

      return updated;
    });
  }
}
