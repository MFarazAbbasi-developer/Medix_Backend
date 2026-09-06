import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MasterDataService } from './master-data.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException } from '@nestjs/common';

describe('MasterDataService', () => {
  let service: MasterDataService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockOrg = { id: 'org-uuid-1', name: 'Medix Pharma' };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn().mockResolvedValue(mockOrg),
      },
      manufacturer: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      productCategory: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      unitOfMeasurement: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    service = new MasterDataService(prisma, auditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Manufacturers', () => {
    it('should create a manufacturer and log audit event', async () => {
      vi.mocked(prisma.manufacturer.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.manufacturer.create).mockResolvedValue({
        id: 'mfg-1',
        name: 'GSK Pakistan',
        code: 'GSK',
      } as any);

      const result = await service.createManufacturer(
        { name: 'GSK Pakistan', code: 'GSK' },
        'user-1',
      );

      expect(result.name).toBe('GSK Pakistan');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_MANUFACTURER',
          entity: 'MANUFACTURER',
        }),
      );
    });

    it('should throw ConflictException on duplicate manufacturer name', async () => {
      vi.mocked(prisma.manufacturer.findUnique).mockResolvedValue({
        id: 'mfg-1',
        name: 'GSK Pakistan',
      } as any);

      await expect(
        service.createManufacturer({ name: 'GSK Pakistan' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('Units of Measurement', () => {
    it('should create a unit and prevent duplicate symbol', async () => {
      vi.mocked(prisma.unitOfMeasurement.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.unitOfMeasurement.create).mockResolvedValue({
        id: 'unit-1',
        name: 'Box',
        symbol: 'Box',
      } as any);

      const result = await service.createUnit(
        { name: 'Box', symbol: 'Box' },
        'user-1',
      );
      expect(result.symbol).toBe('Box');

      // Duplicate test
      vi.mocked(prisma.unitOfMeasurement.findUnique).mockResolvedValue({
        id: 'unit-1',
        symbol: 'Box',
      } as any);

      await expect(
        service.createUnit({ name: 'Box', symbol: 'Box' }, 'user-1'),
      ).rejects.toThrow(ConflictException);
    });
  });
});
