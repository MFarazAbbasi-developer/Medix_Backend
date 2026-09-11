import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SalesRoutesService } from './sales-routes.service';
import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';

describe('SalesRoutesService', () => {
  let service: SalesRoutesService;
  let prisma: any;
  let audit: any;

  const mockOrg = { id: 'org-1', name: 'Medix Pharma' };
  const mockBranch = { id: 'branch-1', organizationId: 'org-1', name: 'Main Branch' };
  const mockSalesman = { id: 'sm-1', organizationId: 'org-1', branchId: 'branch-1', name: 'Tariq', code: 'SM-001' };
  const mockRoute = {
    id: 'route-1',
    organizationId: 'org-1',
    branchId: 'branch-1',
    code: 'RT-KHI-01',
    name: 'Saddar Route',
    city: 'Karachi',
    area: 'District South',
    isActive: true,
    salesmen: [{ salesman: mockSalesman }],
    _count: { customers: 4, salesInvoices: 10 },
  };

  beforeEach(() => {
    prisma = {
      organization: { findFirst: vi.fn().mockResolvedValue(mockOrg) },
      branch: { findFirst: vi.fn().mockResolvedValue(mockBranch) },
      salesman: { findMany: vi.fn().mockResolvedValue([mockSalesman]) },
      salesRoute: {
        findMany: vi.fn().mockResolvedValue([mockRoute]),
        count: vi.fn().mockResolvedValue(1),
        findUnique: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(mockRoute),
        create: vi.fn().mockResolvedValue(mockRoute),
        update: vi.fn().mockResolvedValue(mockRoute),
        delete: vi.fn().mockResolvedValue(mockRoute),
      },
      salesmanRoute: {
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: vi.fn().mockImplementation(async (cb) => cb(prisma)),
    };

    audit = { log: vi.fn().mockResolvedValue(undefined) };
    service = new SalesRoutesService(prisma, audit);
  });

  it('should list routes with assigned salesmen and customer count', async () => {
    const result = await service.getRoutes({ search: 'Saddar' }, 'org-1');
    expect(result.items.length).toBe(1);
    expect(result.items[0].code).toBe('RT-KHI-01');
    expect(result.items[0].assignedSalesmen.length).toBe(1);
    expect(result.items[0].customerCount).toBe(4);
  });

  it('should reject duplicate route code within organization', async () => {
    prisma.salesRoute.findUnique.mockResolvedValue(mockRoute);
    await expect(
      service.createRoute({ code: 'RT-KHI-01', name: 'Duplicate' }, 'user-1', 'org-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('should reject salesman assignment if salesman belongs to different branch', async () => {
    prisma.salesRoute.findUnique.mockResolvedValue(null);
    prisma.salesman.findMany.mockResolvedValue([
      { ...mockSalesman, branchId: 'branch-other' },
    ]);

    await expect(
      service.createRoute(
        { code: 'RT-02', name: 'Clifton', branchId: 'branch-1', salesmanIds: ['sm-1'] },
        'user-1',
        'org-1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('should soft-deactivate route if customers or invoices are attached', async () => {
    prisma.salesRoute.findFirst.mockResolvedValue(mockRoute);
    prisma.salesRoute.update.mockResolvedValue({ ...mockRoute, isActive: false });

    const result = await service.deleteRoute('route-1', 'user-1', 'org-1');
    expect(result.deactivated).toBe(true);
    expect(prisma.salesRoute.update).toHaveBeenCalledWith({
      where: { id: 'route-1' },
      data: { isActive: false },
    });
  });
});
