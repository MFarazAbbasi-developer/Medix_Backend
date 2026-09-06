import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RolesAdminService } from './services/roles-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException } from '@nestjs/common';
import { ROLE_ADMIN } from '../auth/constants';

describe('RolesAdminService', () => {
  let service: RolesAdminService;
  let prisma: any;
  let auditService: any;

  beforeEach(() => {
    prisma = {
      role: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      permission: {
        findMany: vi.fn(),
      },
      rolePermission: {
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(prisma)),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new RolesAdminService(
      prisma as unknown as PrismaService,
      auditService as unknown as AuditService,
    );
  });

  describe('listRoles and getPermissionsMatrix', () => {
    it('should list roles with user counts and permission matrix', async () => {
      prisma.role.findMany.mockResolvedValue([
        {
          id: 'r1',
          name: 'ADMIN',
          description: 'Full System Administrator',
          _count: { userRoles: 2, rolePermissions: 40 },
          rolePermissions: [
            { permission: { code: 'users.manage', description: 'Manage users' } },
            { permission: { code: 'backup.restore', description: 'Restore backup' } },
          ],
        },
      ]);

      prisma.permission.findMany.mockResolvedValue([
        { id: 'p1', code: 'users.manage', description: 'Manage users' },
        { id: 'p2', code: 'sales.create', description: 'Create sales' },
      ]);

      const matrix = await service.getPermissionsMatrix();
      expect(matrix.groups.length).toBeGreaterThan(0);
      expect(matrix.roles.length).toBe(1);
      expect(matrix.roles[0].isSystem).toBe(true);
    });
  });

  describe('updateRole and Safeguards', () => {
    it('should reject removing critical administrative permissions from system ADMIN role', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'r-admin',
        name: ROLE_ADMIN,
        rolePermissions: [],
      });

      await expect(
        service.updateRole(
          'r-admin',
          {
            permissionCodes: ['dashboard.view'], // Missing users.manage, roles.manage, etc.
          },
          { id: 'u1', username: 'admin' },
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent deleting the system ADMIN role', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'r-admin',
        name: ROLE_ADMIN,
        _count: { userRoles: 0 },
      });

      await expect(
        service.deleteRole('r-admin', { id: 'u1', username: 'admin' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should prevent deleting a role assigned to users', async () => {
      prisma.role.findUnique.mockResolvedValue({
        id: 'r-custom',
        name: 'PHARMACIST',
        _count: { userRoles: 3 },
      });

      await expect(
        service.deleteRole('r-custom', { id: 'u1', username: 'admin' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
