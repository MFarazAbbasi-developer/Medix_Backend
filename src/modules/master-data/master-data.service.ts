import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateManufacturerDto,
  UpdateManufacturerDto,
} from './dto/manufacturer.dto';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateUnitDto,
  UpdateUnitDto,
} from './dto/category-unit.dto';

@Injectable()
export class MasterDataService {
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

  // --- Manufacturers ---
  async getManufacturers(includeInactive = false) {
    const orgId = await this.getOrganizationId();
    return this.prisma.manufacturer.findMany({
      where: {
        organizationId: orgId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createManufacturer(dto: CreateManufacturerDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const existing = await this.prisma.manufacturer.findUnique({
      where: {
        organizationId_name: {
          organizationId: orgId,
          name: dto.name.trim(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Manufacturer with name "${dto.name}" already exists`,
      );
    }

    const mfg = await this.prisma.manufacturer.create({
      data: {
        organizationId: orgId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        contactPerson: dto.contactPerson?.trim() || null,
        phone: dto.phone?.trim() || null,
        email: dto.email?.trim() || null,
        address: dto.address?.trim() || null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_MANUFACTURER',
      entity: 'MANUFACTURER',
      entityId: mfg.id,
      details: { name: mfg.name, code: mfg.code },
    });

    return mfg;
  }

  async updateManufacturer(
    id: string,
    dto: UpdateManufacturerDto,
    userId?: string,
  ) {
    const mfg = await this.prisma.manufacturer.findUnique({ where: { id } });
    if (!mfg) {
      throw new NotFoundException(`Manufacturer with ID "${id}" not found`);
    }

    if (dto.name && dto.name.trim() !== mfg.name) {
      const existing = await this.prisma.manufacturer.findUnique({
        where: {
          organizationId_name: {
            organizationId: mfg.organizationId,
            name: dto.name.trim(),
          },
        },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Manufacturer with name "${dto.name}" already exists`,
        );
      }
    }

    const updated = await this.prisma.manufacturer.update({
      where: { id },
      data: {
        ...dto,
        name: dto.name ? dto.name.trim() : undefined,
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_MANUFACTURER',
      entity: 'MANUFACTURER',
      entityId: id,
      details: { changedFields: Object.keys(dto) },
    });

    return updated;
  }

  // --- Categories ---
  async getCategories(includeInactive = false) {
    const orgId = await this.getOrganizationId();
    return this.prisma.productCategory.findMany({
      where: {
        organizationId: orgId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createCategory(dto: CreateCategoryDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const existing = await this.prisma.productCategory.findUnique({
      where: {
        organizationId_name: {
          organizationId: orgId,
          name: dto.name.trim(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Category with name "${dto.name}" already exists`,
      );
    }

    const category = await this.prisma.productCategory.create({
      data: {
        organizationId: orgId,
        name: dto.name.trim(),
        code: dto.code?.trim() || null,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_CATEGORY',
      entity: 'PRODUCT_CATEGORY',
      entityId: category.id,
      details: { name: category.name },
    });

    return category;
  }

  async updateCategory(
    id: string,
    dto: UpdateCategoryDto,
    userId?: string,
  ) {
    const category = await this.prisma.productCategory.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException(`Category with ID "${id}" not found`);
    }

    if (dto.name && dto.name.trim() !== category.name) {
      const existing = await this.prisma.productCategory.findUnique({
        where: {
          organizationId_name: {
            organizationId: category.organizationId,
            name: dto.name.trim(),
          },
        },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Category with name "${dto.name}" already exists`,
        );
      }
    }

    const updated = await this.prisma.productCategory.update({
      where: { id },
      data: {
        ...dto,
        name: dto.name ? dto.name.trim() : undefined,
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_CATEGORY',
      entity: 'PRODUCT_CATEGORY',
      entityId: id,
      details: { changedFields: Object.keys(dto) },
    });

    return updated;
  }

  // --- Units of Measurement ---
  async getUnits(includeInactive = false) {
    const orgId = await this.getOrganizationId();
    return this.prisma.unitOfMeasurement.findMany({
      where: {
        organizationId: orgId,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createUnit(dto: CreateUnitDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const existing = await this.prisma.unitOfMeasurement.findUnique({
      where: {
        organizationId_symbol: {
          organizationId: orgId,
          symbol: dto.symbol.trim(),
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Unit with symbol "${dto.symbol}" already exists`,
      );
    }

    const unit = await this.prisma.unitOfMeasurement.create({
      data: {
        organizationId: orgId,
        name: dto.name.trim(),
        symbol: dto.symbol.trim(),
        isActive: dto.isActive ?? true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_UNIT',
      entity: 'UNIT_OF_MEASUREMENT',
      entityId: unit.id,
      details: { name: unit.name, symbol: unit.symbol },
    });

    return unit;
  }

  async updateUnit(id: string, dto: UpdateUnitDto, userId?: string) {
    const unit = await this.prisma.unitOfMeasurement.findUnique({ where: { id } });
    if (!unit) {
      throw new NotFoundException(`Unit with ID "${id}" not found`);
    }

    if (dto.symbol && dto.symbol.trim() !== unit.symbol) {
      const existing = await this.prisma.unitOfMeasurement.findUnique({
        where: {
          organizationId_symbol: {
            organizationId: unit.organizationId,
            symbol: dto.symbol.trim(),
          },
        },
      });
      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Unit with symbol "${dto.symbol}" already exists`,
        );
      }
    }

    const updated = await this.prisma.unitOfMeasurement.update({
      where: { id },
      data: {
        ...dto,
        name: dto.name ? dto.name.trim() : undefined,
        symbol: dto.symbol ? dto.symbol.trim() : undefined,
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_UNIT',
      entity: 'UNIT_OF_MEASUREMENT',
      entityId: id,
      details: { changedFields: Object.keys(dto) },
    });

    return updated;
  }
}
