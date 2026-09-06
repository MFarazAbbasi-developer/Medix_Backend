import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrganizationService } from './organization.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';

describe('OrganizationService', () => {
  let service: OrganizationService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockOrg = {
    id: 'org-uuid-1',
    name: 'Medix Pharma Distribution',
    legalName: 'Medix Pharma Distribution (Pvt) Ltd',
    country: 'Pakistan',
    city: 'Karachi',
    ntn: '7100234-5',
    strn: '17-00-7100-234-11',
    drugSaleLicenseNo: 'DSL-KHI-2026-894',
    logoUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBranch = {
    id: 'branch-uuid-1',
    organizationId: 'org-uuid-1',
    name: 'Head Office',
    code: 'HO',
    isHeadOffice: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      branch: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    service = new OrganizationService(prisma, auditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOrganization', () => {
    it('should return the active organization', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(mockOrg as any);

      const result = await service.getOrganization();
      expect(result).toEqual(mockOrg);
      expect(prisma.organization.findFirst).toHaveBeenCalled();
    });

    it('should throw NotFoundException when no organization exists', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);

      await expect(service.getOrganization()).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateOrganization', () => {
    it('should update existing organization and log audit event', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.organization.update).mockResolvedValue({
        ...mockOrg,
        name: 'Updated Pharma Name',
      } as any);

      const result = await service.updateOrganization(
        { name: 'Updated Pharma Name' },
        'user-uuid-1',
      );

      expect(result.name).toBe('Updated Pharma Name');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_ORGANIZATION',
          entity: 'ORGANIZATION',
        }),
      );
    });
  });

  describe('createBranch', () => {
    it('should create a branch successfully', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.branch.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.branch.create).mockResolvedValue(mockBranch as any);

      const result = await service.createBranch(
        { name: 'Head Office', code: 'HO', isHeadOffice: true },
        'user-uuid-1',
      );

      expect(result.code).toBe('HO');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_BRANCH',
          entity: 'BRANCH',
        }),
      );
    });

    it('should throw ConflictException if branch code is duplicated', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.branch.findUnique).mockResolvedValue(mockBranch as any);

      await expect(
        service.createBranch({ name: 'Duplicate', code: 'HO' }, 'user-uuid-1'),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('deleteBranch', () => {
    it('should reject deleting head office', async () => {
      vi.mocked(prisma.branch.findUnique).mockResolvedValue(mockBranch as any);

      await expect(
        service.deleteBranch('branch-uuid-1', 'user-uuid-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
