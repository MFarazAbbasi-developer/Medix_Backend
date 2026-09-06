import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Retrieves the current organization profile.
   */
  async getOrganization() {
    const org = await this.prisma.organization.findFirst({
      include: {
        branches: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!org) {
      throw new NotFoundException('Organization profile has not been initialized');
    }

    return org;
  }

  /**
   * Updates the organization profile.
   */
  async updateOrganization(dto: UpdateOrganizationDto, userId?: string) {
    const existing = await this.prisma.organization.findFirst();

    let updatedOrg;
    if (!existing) {
      updatedOrg = await this.prisma.organization.create({
        data: {
          name: dto.name || 'Medix Distribution',
          ...dto,
        },
      });
    } else {
      updatedOrg = await this.prisma.organization.update({
        where: { id: existing.id },
        data: dto,
      });
    }

    await this.auditService.log({
      userId,
      action: 'UPDATE_ORGANIZATION',
      entity: 'ORGANIZATION',
      entityId: updatedOrg.id,
      details: { changedFields: Object.keys(dto) },
    });

    return updatedOrg;
  }

  /**
   * Lists all branches for the organization.
   */
  async getBranches() {
    const org = await this.getOrganization();
    return this.prisma.branch.findMany({
      where: { organizationId: org.id },
      orderBy: [{ isHeadOffice: 'desc' }, { name: 'asc' }],
    });
  }

  /**
   * Retrieves a branch by ID.
   */
  async getBranchById(id: string) {
    const branch = await this.prisma.branch.findUnique({
      where: { id },
    });

    if (!branch) {
      throw new NotFoundException(`Branch with ID "${id}" not found`);
    }

    return branch;
  }

  /**
   * Creates a new branch under the organization.
   */
  async createBranch(dto: CreateBranchDto, userId?: string) {
    const org = await this.getOrganization();

    const existingCode = await this.prisma.branch.findUnique({
      where: {
        organizationId_code: {
          organizationId: org.id,
          code: dto.code.trim().toUpperCase(),
        },
      },
    });

    if (existingCode) {
      throw new ConflictException(`Branch code "${dto.code}" is already in use`);
    }

    // If marked as head office, unset any other head office
    if (dto.isHeadOffice) {
      await this.prisma.branch.updateMany({
        where: { organizationId: org.id, isHeadOffice: true },
        data: { isHeadOffice: false },
      });
    }

    const branch = await this.prisma.branch.create({
      data: {
        organizationId: org.id,
        name: dto.name.trim(),
        code: dto.code.trim().toUpperCase(),
        address: dto.address,
        city: dto.city,
        phone: dto.phone,
        email: dto.email,
        isHeadOffice: dto.isHeadOffice ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_BRANCH',
      entity: 'BRANCH',
      entityId: branch.id,
      details: { code: branch.code, name: branch.name },
    });

    return branch;
  }

  /**
   * Updates an existing branch.
   */
  async updateBranch(id: string, dto: UpdateBranchDto, userId?: string) {
    const branch = await this.getBranchById(id);

    if (dto.code && dto.code.trim().toUpperCase() !== branch.code) {
      const existingCode = await this.prisma.branch.findUnique({
        where: {
          organizationId_code: {
            organizationId: branch.organizationId,
            code: dto.code.trim().toUpperCase(),
          },
        },
      });

      if (existingCode && existingCode.id !== id) {
        throw new ConflictException(`Branch code "${dto.code}" is already in use`);
      }
    }

    // If marked as head office, unset any other head office
    if (dto.isHeadOffice) {
      await this.prisma.branch.updateMany({
        where: {
          organizationId: branch.organizationId,
          isHeadOffice: true,
          NOT: { id },
        },
        data: { isHeadOffice: false },
      });
    }

    const updated = await this.prisma.branch.update({
      where: { id },
      data: {
        ...dto,
        code: dto.code ? dto.code.trim().toUpperCase() : undefined,
        name: dto.name ? dto.name.trim() : undefined,
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_BRANCH',
      entity: 'BRANCH',
      entityId: updated.id,
      details: { changedFields: Object.keys(dto) },
    });

    return updated;
  }

  /**
   * Deactivates or removes a branch.
   */
  async deleteBranch(id: string, userId?: string) {
    const branch = await this.getBranchById(id);

    if (branch.isHeadOffice) {
      throw new BadRequestException('Cannot delete the Head Office branch');
    }

    await this.prisma.branch.delete({
      where: { id },
    });

    await this.auditService.log({
      userId,
      action: 'DELETE_BRANCH',
      entity: 'BRANCH',
      entityId: id,
      details: { code: branch.code, name: branch.name },
    });

    return { success: true, message: `Branch "${branch.name}" deleted successfully` };
  }
}
