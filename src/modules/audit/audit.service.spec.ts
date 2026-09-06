import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuditService } from './audit.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AuditService', () => {
  let service: AuditService;
  let prisma: PrismaService;

  beforeEach(() => {
    prisma = {
      auditLog: {
        create: vi.fn(),
        count: vi.fn(),
        findMany: vi.fn(),
      },
    } as unknown as PrismaService;

    service = new AuditService(prisma);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('log', () => {
    it('should sanitize passwords and tokens from details before logging', async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any);

      await service.log({
        userId: 'user-1',
        action: 'LOGIN_ATTEMPT',
        entity: 'USER',
        entityId: 'user-1',
        details: {
          username: 'admin',
          password: 'superSecretPassword',
          refreshToken: 'secret-refresh-token',
          nested: {
            accessToken: 'nested-token',
            allowedField: 'safeValue',
          },
        },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          details: {
            username: 'admin',
            password: '[REDACTED]',
            refreshToken: '[REDACTED]',
            nested: {
              accessToken: '[REDACTED]',
              allowedField: 'safeValue',
            },
          },
        }),
      });
    });

    it('should not throw error if database write fails', async () => {
      vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error('DB connection lost'));

      await expect(
        service.log({
          userId: 'user-1',
          action: 'FAIL_TEST',
          entity: 'TEST',
        }),
      ).resolves.not.toThrow();
    });
  });

  describe('getLogs', () => {
    it('should return paginated audit logs with meta', async () => {
      vi.mocked(prisma.auditLog.count).mockResolvedValue(1);
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        {
          id: 'log-1',
          userId: 'user-1',
          action: 'CREATE_BRANCH',
          entity: 'BRANCH',
          entityId: 'branch-1',
          details: { code: 'HO' },
          ipAddress: '127.0.0.1',
          userAgent: 'TestAgent',
          createdAt: new Date(),
          user: { id: 'user-1', username: 'admin', displayName: 'Admin' },
        },
      ] as any);

      const result = await service.getLogs({ page: 1, limit: 10 });
      expect(result.items).toHaveLength(1);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });
  });
});
