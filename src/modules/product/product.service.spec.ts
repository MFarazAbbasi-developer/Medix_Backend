import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProductService } from './product.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('ProductService', () => {
  let service: ProductService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockOrg = { id: 'org-uuid-1', name: 'Medix Pharma' };

  const mockProduct = {
    id: 'prod-1',
    organizationId: 'org-uuid-1',
    sku: 'PAN-500-TAB',
    name: 'Panadol 500mg Tablets',
    genericName: 'Paracetamol',
    dosageForm: 'Tablet',
    strength: '500mg',
    packSize: '10x10',
    barcode: '8964000123456',
    taxPercentage: new Prisma.Decimal(0),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      product: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    service = new ProductService(prisma, auditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return paginated products with search filter', async () => {
      vi.mocked(prisma.product.count).mockResolvedValue(1);
      vi.mocked(prisma.product.findMany).mockResolvedValue([mockProduct] as any);

      const result = await service.findAll({ search: 'Panadol', page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              { name: { contains: 'Panadol', mode: 'insensitive' } },
            ]),
          }),
        }),
      );
    });
  });

  describe('create', () => {
    it('should create a product with user-defined SKU and log audit record', async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.product.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.product.create).mockResolvedValue(mockProduct as any);

      const result = await service.create(
        {
          sku: 'PAN-500-TAB',
          name: 'Panadol 500mg Tablets',
          genericName: 'Paracetamol',
          dosageForm: 'Tablet',
          strength: '500mg',
        },
        'user-1',
      );

      expect(result.sku).toBe('PAN-500-TAB');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_PRODUCT',
          entity: 'PRODUCT',
        }),
      );
    });

    it('should reject duplicate SKU per organization', async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as any);

      await expect(
        service.create(
          {
            sku: 'PAN-500-TAB',
            name: 'Another Paracetamol',
            genericName: 'Paracetamol',
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('toggleStatus', () => {
    it('should update isActive status and log audit event', async () => {
      vi.mocked(prisma.product.findUnique).mockResolvedValue(mockProduct as any);
      vi.mocked(prisma.product.update).mockResolvedValue({
        ...mockProduct,
        isActive: false,
      } as any);

      const result = await service.toggleStatus('prod-1', false, 'user-1');
      expect(result.isActive).toBe(false);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TOGGLE_PRODUCT_STATUS',
          entity: 'PRODUCT',
        }),
      );
    });
  });
});
