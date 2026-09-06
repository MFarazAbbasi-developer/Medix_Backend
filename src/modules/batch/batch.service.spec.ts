import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchService } from './batch.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { BatchStatus, Prisma } from '@prisma/client';

describe('BatchService', () => {
  let service: BatchService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockProduct = {
    id: 'prod-1',
    name: 'Panadol 500mg',
    sku: 'PAN-500',
  };

  const mockBatch = {
    id: 'batch-1',
    productId: 'prod-1',
    batchNumber: 'BN-2026-01',
    mfgDate: new Date('2026-01-01'),
    expiryDate: new Date('2028-01-01'),
    purchaseCost: new Prisma.Decimal(120.0),
    tradePrice: new Prisma.Decimal(150.0),
    retailPrice: new Prisma.Decimal(172.5),
    status: BatchStatus.ACTIVE,
    remarks: 'Standard factory release',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      product: {
        findUnique: vi.fn().mockResolvedValue(mockProduct),
      },
      batch: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
      },
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    service = new BatchService(prisma, auditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a batch successfully with valid pricing and dates', async () => {
      vi.mocked(prisma.batch.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.batch.create).mockResolvedValue(mockBatch as any);

      const result = await service.create(
        'prod-1',
        {
          batchNumber: 'BN-2026-01',
          mfgDate: '2026-01-01',
          expiryDate: '2028-01-01',
          purchaseCost: 120.0,
          tradePrice: 150.0,
          retailPrice: 172.5,
          status: BatchStatus.ACTIVE,
        },
        'user-1',
      );

      expect(result.batchNumber).toBe('BN-2026-01');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_BATCH',
          entity: 'BATCH',
        }),
      );
    });

    it('should throw ConflictException if batch number is already registered for this product', async () => {
      vi.mocked(prisma.batch.findUnique).mockResolvedValue(mockBatch as any);

      await expect(
        service.create(
          'prod-1',
          {
            batchNumber: 'BN-2026-01',
            expiryDate: '2028-01-01',
            purchaseCost: 120,
            tradePrice: 150,
            retailPrice: 172.5,
          },
          'user-1',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if expiryDate is before or equal to mfgDate', async () => {
      vi.mocked(prisma.batch.findUnique).mockResolvedValue(null);

      await expect(
        service.create(
          'prod-1',
          {
            batchNumber: 'BN-BAD-DATES',
            mfgDate: '2026-06-01',
            expiryDate: '2025-01-01', // Invalid: before mfgDate
            purchaseCost: 100,
            tradePrice: 120,
            retailPrice: 140,
          },
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findByProduct FEFO ordering', () => {
    it('should fetch batches sorted by expiryDate in ascending order', async () => {
      vi.mocked(prisma.batch.findMany).mockResolvedValue([mockBatch] as any);

      const result = await service.findByProduct('prod-1');
      expect(result).toHaveLength(1);
      expect(prisma.batch.findMany).toHaveBeenCalledWith({
        where: { productId: 'prod-1' },
        orderBy: { expiryDate: 'asc' },
      });
    });
  });
});
