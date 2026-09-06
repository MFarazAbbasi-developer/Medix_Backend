import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, BadRequestException } from '@nestjs/common';

describe('WarehouseService', () => {
  let service: WarehouseService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockOrg = { id: 'org-uuid-1', name: 'Medix Pharma' };
  const mockBranch = { id: 'branch-uuid-1', organizationId: 'org-uuid-1', name: 'Main Branch', code: 'HO' };
  const mockWarehouse = {
    id: 'wh-uuid-1',
    organizationId: 'org-uuid-1',
    branchId: 'branch-uuid-1',
    name: 'Main Storage',
    code: 'WH-MAIN',
    isDefault: true,
    isActive: true,
  };

  beforeEach(() => {
    prisma = {
      organization: { findFirst: vi.fn() },
      branch: { findFirst: vi.fn() },
      warehouse: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation((cb) => cb(prisma)),
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn(),
    } as unknown as AuditService;

    service = new WarehouseService(prisma, auditService);
  });

  it('should list warehouses filtered by branch', async () => {
    vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
    vi.spyOn(prisma.warehouse, 'findMany').mockResolvedValue([mockWarehouse] as any);

    const result = await service.getWarehouses('branch-uuid-1');

    expect(result).toHaveLength(1);
    expect(result[0].code).toBe('WH-MAIN');
    expect(prisma.warehouse.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-uuid-1', branchId: 'branch-uuid-1', isActive: true },
      }),
    );
  });

  it('should create a warehouse after validating branch and unique code', async () => {
    vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
    vi.spyOn(prisma.branch, 'findFirst').mockResolvedValue(mockBranch as any);
    vi.spyOn(prisma.warehouse, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.warehouse, 'create').mockResolvedValue(mockWarehouse as any);

    const result = await service.createWarehouse({
      branchId: 'branch-uuid-1',
      name: 'Main Storage',
      code: 'WH-MAIN',
      isDefault: true,
    });

    expect(result.code).toBe('WH-MAIN');
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATE_WAREHOUSE' }),
    );
  });

  it('should reject creation if warehouse code already exists in branch', async () => {
    vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
    vi.spyOn(prisma.branch, 'findFirst').mockResolvedValue(mockBranch as any);
    vi.spyOn(prisma.warehouse, 'findUnique').mockResolvedValue(mockWarehouse as any);

    await expect(
      service.createWarehouse({
        branchId: 'branch-uuid-1',
        name: 'Main Storage',
        code: 'WH-MAIN',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should reject creation if branch is invalid', async () => {
    vi.spyOn(prisma.organization, 'findFirst').mockResolvedValue(mockOrg as any);
    vi.spyOn(prisma.branch, 'findFirst').mockResolvedValue(null);

    await expect(
      service.createWarehouse({
        branchId: 'invalid-branch',
        name: 'Main Storage',
        code: 'WH-MAIN',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
