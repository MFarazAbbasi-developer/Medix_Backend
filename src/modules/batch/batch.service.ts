import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateBatchDto,
  UpdateBatchDto,
  QueryBatchDto,
} from './dto/create-update-batch.dto';
import { Prisma, BatchStatus } from '@prisma/client';

@Injectable()
export class BatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Retrieves all batches for a specific product, ordered by expiryDate ASC (FEFO).
   */
  async findByProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found`);
    }

    return this.prisma.batch.findMany({
      where: { productId },
      orderBy: { expiryDate: 'asc' },
    });
  }

  /**
   * Retrieves paginated batches across products with search and filtering.
   */
  async findAll(query: QueryBatchDto) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.BatchWhereInput = {};

    if (query.productId) {
      where.productId = query.productId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { batchNumber: { contains: term, mode: 'insensitive' } },
        { product: { name: { contains: term, mode: 'insensitive' } } },
        { product: { sku: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.batch.count({ where }),
      this.prisma.batch.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ expiryDate: 'asc' }],
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              name: true,
              genericName: true,
              dosageForm: true,
              packSize: true,
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
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Registers a new batch lot for a product.
   */
  async create(productId: string, dto: CreateBatchDto, userId?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${productId}" not found`);
    }

    const batchNumber = dto.batchNumber.trim();

    // Check duplicate batch number for this product
    const existing = await this.prisma.batch.findUnique({
      where: {
        productId_batchNumber: {
          productId,
          batchNumber,
        },
      },
    });

    if (existing) {
      throw new ConflictException(
        `Batch "${batchNumber}" already exists for product "${product.name}"`,
      );
    }

    // Validate dates
    const expiryDate = new Date(dto.expiryDate);
    if (isNaN(expiryDate.getTime())) {
      throw new BadRequestException('Invalid expiry date format');
    }

    let mfgDate: Date | null = null;
    if (dto.mfgDate) {
      mfgDate = new Date(dto.mfgDate);
      if (isNaN(mfgDate.getTime())) {
        throw new BadRequestException('Invalid manufacturing date format');
      }
      if (expiryDate <= mfgDate) {
        throw new BadRequestException(
          'Expiry date must be after manufacturing date',
        );
      }
    }

    const batch = await this.prisma.batch.create({
      data: {
        productId,
        batchNumber,
        mfgDate,
        expiryDate,
        purchaseCost: new Prisma.Decimal(dto.purchaseCost),
        tradePrice: new Prisma.Decimal(dto.tradePrice),
        retailPrice: new Prisma.Decimal(dto.retailPrice),
        status: dto.status || BatchStatus.ACTIVE,
        remarks: dto.remarks?.trim() || null,
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true },
        },
      },
    });

    await this.auditService.log({
      userId,
      action: 'CREATE_BATCH',
      entity: 'BATCH',
      entityId: batch.id,
      details: {
        productId,
        productName: product.name,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        tradePrice: batch.tradePrice.toString(),
        retailPrice: batch.retailPrice.toString(),
      },
    });

    return batch;
  }

  /**
   * Updates an existing batch's pricing, dates, status, or remarks.
   */
  async update(id: string, dto: UpdateBatchDto, userId?: string) {
    const batch = await this.prisma.batch.findUnique({
      where: { id },
      include: { product: true },
    });

    if (!batch) {
      throw new NotFoundException(`Batch with ID "${id}" not found`);
    }

    // Check duplicate batch number if changed
    if (dto.batchNumber && dto.batchNumber.trim() !== batch.batchNumber) {
      const existing = await this.prisma.batch.findUnique({
        where: {
          productId_batchNumber: {
            productId: batch.productId,
            batchNumber: dto.batchNumber.trim(),
          },
        },
      });

      if (existing && existing.id !== id) {
        throw new ConflictException(
          `Batch "${dto.batchNumber.trim()}" already exists for this product`,
        );
      }
    }

    // Validate dates if modified
    const expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : batch.expiryDate;
    const mfgDate = dto.mfgDate ? new Date(dto.mfgDate) : batch.mfgDate;

    if (mfgDate && expiryDate <= mfgDate) {
      throw new BadRequestException(
        'Expiry date must be after manufacturing date',
      );
    }

    const updated = await this.prisma.batch.update({
      where: { id },
      data: {
        batchNumber: dto.batchNumber ? dto.batchNumber.trim() : undefined,
        mfgDate: dto.mfgDate !== undefined ? (dto.mfgDate ? new Date(dto.mfgDate) : null) : undefined,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        purchaseCost:
          dto.purchaseCost !== undefined
            ? new Prisma.Decimal(dto.purchaseCost)
            : undefined,
        tradePrice:
          dto.tradePrice !== undefined
            ? new Prisma.Decimal(dto.tradePrice)
            : undefined,
        retailPrice:
          dto.retailPrice !== undefined
            ? new Prisma.Decimal(dto.retailPrice)
            : undefined,
        status: dto.status,
        remarks: dto.remarks !== undefined ? dto.remarks?.trim() || null : undefined,
      },
      include: {
        product: {
          select: { id: true, name: true, sku: true },
        },
      },
    });

    await this.auditService.log({
      userId,
      action: 'UPDATE_BATCH',
      entity: 'BATCH',
      entityId: id,
      details: {
        batchNumber: updated.batchNumber,
        changedFields: Object.keys(dto),
      },
    });

    return updated;
  }
}
