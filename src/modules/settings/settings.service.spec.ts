import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsService } from './settings.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotFoundException } from '@nestjs/common';

describe('SettingsService', () => {
  let service: SettingsService;
  let prisma: PrismaService;
  let auditService: AuditService;

  const mockOrg = { id: 'org-uuid-1', name: 'Medix Pharma' };

  const mockSettings = [
    {
      id: 's-1',
      organizationId: 'org-uuid-1',
      key: 'currency',
      value: 'PKR',
      dataType: 'STRING',
      group: 'GENERAL',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 's-2',
      organizationId: 'org-uuid-1',
      key: 'defaultTaxRate',
      value: '0',
      dataType: 'NUMBER',
      group: 'TAX',
      description: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  beforeEach(() => {
    prisma = {
      organization: {
        findFirst: vi.fn(),
      },
      systemSetting: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation(async (callback) => {
        return callback({
          systemSetting: {
            upsert: vi.fn().mockResolvedValue({}),
          },
        });
      }),
    } as unknown as PrismaService;

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    service = new SettingsService(prisma, auditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getAllSettings', () => {
    it('should return items list and lookup map', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.systemSetting.findMany).mockResolvedValue(mockSettings as any);

      const result = await service.getAllSettings();
      expect(result.items).toHaveLength(2);
      expect(result.map).toEqual({
        currency: 'PKR',
        defaultTaxRate: '0',
      });
    });

    it('should throw NotFoundException if organization does not exist', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(null);

      await expect(service.getAllSettings()).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateSettings', () => {
    it('should upsert settings and log audit entry', async () => {
      vi.mocked(prisma.organization.findFirst).mockResolvedValue(mockOrg as any);
      vi.mocked(prisma.systemSetting.findMany).mockResolvedValue(mockSettings as any);

      await service.updateSettings(
        {
          settings: [
            { key: 'currency', value: 'PKR' },
            { key: 'defaultTaxRate', value: '5' },
          ],
        },
        'user-uuid-1',
      );

      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE_SETTINGS',
          entity: 'SYSTEM_SETTING',
        }),
      );
    });
  });
});
