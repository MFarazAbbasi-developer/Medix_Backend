import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesmenService } from './salesmen.service';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('SalesmenService', () => {
  let service: SalesmenService;
  let prisma: any;
  let audit: any;

  const mockOrg = { id: 'org-1', name: 'Medix Pharma' };
  const mockBranch = { id: 'branch-1', organizationId: 'org-1', name: 'Main Branch' };
  const mockRoute = { id: 'route-1', organizationId: 'org-1', branchId: 'branch-1', name: 'Saddar Route', code: 'RT-01' };
  const mockSalesman = {
    id: 'sm-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    code: 'SM-001',
    name: 'Tariq Mahmood',
    phone: '+92-300-1122334',
    email: 'tariq@medix.pk',
    isActive: true,
    routes: [{ route: mockRoute }],
    _count: { defaultForCustomers: 2, salesInvoices: 5 },
  };

  beforeEach(() => {
    prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(mockOrg) },
      branch: { findFirst: vi.fn().mockResolvedValue(mockBranch) },
      salesRoute: { findMany: vi.fn().mockResolvedValue([mockRoute]) },
      salesman: {
        findMany: vi.fn().mockResolvedValue([mockSalesman]),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(mockSalesman),
        create: vi.fn().mockResolvedValue(mockSalesman),
        update: vi.fn().mockResolvedValue(mockSalesman),
        delete: vi.fn().mockResolvedValue(mockSalesman),
      },
      salesmanRoute: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new SalesmenService(prisma, audit);
  });

  it('should list salesmen with assigned routes and customer counts', async () => {
    const result = await service.getSalesmen({ search: 'Tariq' }, 'org-1');
    expect(result.items.length).toBe(1);
    expect(result.items[0].code).toBe('SM-001');
    expect(result.items[0].assignedRoutes.length).toBe(1);
    expect(result.items[0].customerCount).toBe(2);
  });

  it('should reject duplicate salesman code within organization', async () => {
    prisma.salesman.findUnique.mockResolvedValue(mockSalesman);
    await expect(
      service.createSalesman({ code: 'SM-001', name: 'Duplicate' }, 'user-1', 'org-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('should reject route assignment if route belongs to different branch', async () => {
    prisma.salesman.findUnique.mockResolvedValue(null);
    prisma.salesRoute.findMany.mockResolvedValue([
      { ...mockRoute, branchId: 'branch-other' },
    ]);

    await expect(
      service.createSalesman(
        { code: 'SM-002', name: 'Rashid', branchId: 'branch-1', routeIds: ['route-1'] },
        'user-1',
        'org-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should soft-deactivate salesman if historical records are attached', async () => {
    prisma.salesman.findFirst.mockResolvedValue(mockSalesman);
    prisma.salesman.update.mockResolvedValue({ ...mockSalesman, isActive: false });

    const result = await service.deleteSalesman('sm-1', 'user-1', 'org-1');
    expect(result.deactivated).toBe(true);
    expect(prisma.salesman.update).toHaveBeenCalledWith({
      where: { id: 'sm-1' },
      data: { isActive: false },
    });
  });
});
