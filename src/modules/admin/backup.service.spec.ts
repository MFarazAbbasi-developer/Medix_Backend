import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BackupService } from './services/backup.service';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BadRequestException } from '@nestjs/common';

describe('BackupService', () => {
  let service: BackupService;
  let auditService: any;
  let prisma: any;
  let configService: any;

  beforeEach(() => {
    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    prisma = {
      $queryRaw: vi.fn(),
    };

    configService = {
      get: vi.fn().mockReturnValue('postgresql://postgres:postgres@localhost:5432/medix_db'),
    };

    service = new BackupService(
      configService as unknown as ConfigService,
      auditService as unknown as AuditService,
      prisma as unknown as PrismaService,
    );
  });

  describe('listBackups', () => {
    it('should list backups directory and return manifest items', async () => {
      const result = await service.listBackups();
      expect(result).toHaveProperty('backupDirectory');
      expect(Array.isArray(result.items)).toBe(true);
    });
  });

  describe('restoreBackup Safeguard', () => {
    it('should reject restore if confirmationToken is not CONFIRM_RESTORE', async () => {
      await expect(
        service.restoreBackup(
          {
            filename: 'test_backup.dump',
            confirmationToken: 'wrong_token',
          },
          { id: 'u1', username: 'admin' },
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
