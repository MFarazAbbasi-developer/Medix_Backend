import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateProductDto,
  UpdateProductDto,
} from './dto/create-update-product.dto';
import { QueryProductDto } from './dto/query-product.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductService {
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
   * Retrieves paginated products with multi-field search and filters.
   */
  async findAll(query: QueryProductDto) {
    const orgId = await this.getOrganizationId();
    const page = query.page || 1;
    const limit = query.limit || 25;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      organizationId: orgId,
    };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === 'true';
    }

    if (query.categoryId) {
      where.categoryId = query.categoryId;
    }

    if (query.manufacturerId) {
      where.manufacturerId = query.manufacturerId;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { genericName: { contains: term, mode: 'insensitive' } },
        { sku: { contains: term, mode: 'insensitive' } },
        { barcode: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ name: 'asc' }],
        include: {
          manufacturer: {
            select: { id: true, name: true, code: true },
          },
          category: {
            select: { id: true, name: true, code: true },
          },
          unit: {
            select: { id: true, name: true, symbol: true },
          },
          _count: {
            select: { batches: true },
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retrieves full details of a product along with all associated batches.
   */
  async findOne(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        manufacturer: true,
        category: true,
        unit: true,
        batches: {
          orderBy: { expiryDate: 'asc' }, // FEFO ordering
        },
      },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    return product;
  }

  /**
   * Creates a new pharmaceutical product with user-defined SKU.
   */
  async create(dto: CreateProductDto, userId?: string) {
    const orgId = await this.getOrganizationId();
    const sku = dto.sku.trim();

    // Check SKU uniqueness per organization
    const existingSku = await this.prisma.product.findUnique({
      where: {
        organizationId_sku: {
          organizationId: orgId,
          sku,
        },
      },
    });

    if (existingSku) {
      throw new ConflictException(`Product with SKU "${sku}" already exists`);
    }

    // Check Barcode uniqueness per organization if provided
    if (dto.barcode && dto.barcode.trim().length > 0) {
      const barcode = dto.barcode.trim();
      const existingBarcode = await this.prisma.product.findFirst({
        where: {
          organizationId: orgId,
          barcode,
        },
      });

      if (existingBarcode) {
        throw new ConflictException(
          `Product with Barcode "${barcode}" already exists`,
        );
      }
    }

    const product = await this.prisma.product.create({
      data: {
        organizationId: orgId,
        sku,
        name: dto.name.trim(),
        genericName: dto.genericName.trim(),
        manufacturerId: dto.manufacturerId || null,
        categoryId: dto.categoryId || null,
        unitId: dto.unitId || null,
        dosageForm: dto.dosageForm?.trim() || null,
        strength: dto.strength?.trim() || null,
        packSize: dto.packSize?.trim() || null,
        barcode: dto.barcode?.trim() || null,
        taxPercentage:
          dto.taxPercentage !== undefined ? new Prisma.Decimal(dto.taxPercentage) : 0,
        description: dto.description?.trim() || null,
        isActive: dto.isActive ?? true,
      },
      include: {
        manufacturer: true,
        category: true,
        unit: true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_PRODUCT',
      entity: 'PRODUCT',
      entityId: product.id,
      details: { sku: product.sku, name: product.name, genericName: product.genericName },
    });

    return product;
  }

  /**
   * Updates an existing product's metadata.
   */
  async update(id: string, dto: UpdateProductDto, userId?: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    if (dto.sku && dto.sku.trim() !== product.sku) {
      const existingSku = await this.prisma.product.findUnique({
        where: {
          organizationId_sku: {
            organizationId: product.organizationId,
            sku: dto.sku.trim(),
          },
        },
      });
      if (existingSku && existingSku.id !== id) {
        throw new ConflictException(
          `Product with SKU "${dto.sku.trim()}" already exists`,
        );
      }
    }

    if (dto.barcode && dto.barcode.trim() !== product.barcode) {
      const existingBarcode = await this.prisma.product.findFirst({
        where: {
          organizationId: product.organizationId,
          barcode: dto.barcode.trim(),
          NOT: { id },
        },
      });
      if (existingBarcode) {
        throw new ConflictException(
          `Product with Barcode "${dto.barcode.trim()}" already exists`,
        );
      }
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...dto,
        sku: dto.sku ? dto.sku.trim() : undefined,
        name: dto.name ? dto.name.trim() : undefined,
        genericName: dto.genericName ? dto.genericName.trim() : undefined,
        dosageForm: dto.dosageForm !== undefined ? dto.dosageForm?.trim() || null : undefined,
        strength: dto.strength !== undefined ? dto.strength?.trim() || null : undefined,
        packSize: dto.packSize !== undefined ? dto.packSize?.trim() || null : undefined,
        barcode: dto.barcode !== undefined ? dto.barcode?.trim() || null : undefined,
        taxPercentage:
          dto.taxPercentage !== undefined
            ? new Prisma.Decimal(dto.taxPercentage)
            : undefined,
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
      },
      include: {
        manufacturer: true,
        category: true,
        unit: true,
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_PRODUCT',
      entity: 'PRODUCT',
      entityId: id,
      details: { changedFields: Object.keys(dto) },
    });

    return updated;
  }

  /**
   * Soft-activates or soft-deactivates a product.
   */
  async toggleStatus(id: string, isActive: boolean, userId?: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    const updated = await this.prisma.product.update({
      where: { id },
      data: { isActive },
    });

    await this.auditService.log({
      userId,
      action: 'TOGGLE_PRODUCT_STATUS',
      entity: 'PRODUCT',
      entityId: id,
      details: { sku: product.sku, isActive },
    });

    return updated;
  }
}
