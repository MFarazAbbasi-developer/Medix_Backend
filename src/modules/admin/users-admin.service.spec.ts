import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UsersAdminService } from './services/users-admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { AuditService } from '../audit/audit.service';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ROLE_ADMIN } from '../auth/constants';

describe('UsersAdminService', () => {
  let service: UsersAdminService;
  let prisma: any;
  let passwordService: any;
  let auditService: any;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      role: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      userRole: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
        count: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      branch: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(prisma)),
    };

    passwordService = {
      hash: vi.fn().mockResolvedValue('argon2id_mock_hashed_pass'),
      verify: vi.fn().mockResolvedValue(true),
    };

    auditService = {
      log: vi.fn().mockResolvedValue(undefined),
    };

    service = new UsersAdminService(
      prisma as unknown as PrismaService,
      passwordService as unknown as PasswordService,
      auditService as unknown as AuditService,
    );
  });

  describe('listUsers', () => {
    it('should list users with pagination and sanitize credentials', async () => {
      prisma.user.count.mockResolvedValue(1);
      prisma.user.findMany.mockResolvedValue([
        {
          id: 'u1',
          username: 'admin',
          displayName: 'Administrator',
          status: 'ACTIVE',
          passwordHash: 'secret_hash',
          userRoles: [
            {
              role: { id: 'r1', name: 'ADMIN', description: 'System Administrator' },
            },
          ],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.listUsers({ page: 1, limit: 10 });
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).passwordHash).toBeUndefined();
      expect(result.items[0].username).toBe('admin');
      expect(result.items[0].roles[0].name).toBe('ADMIN');
      expect(result.items[0].isActive).toBe(true);
      expect(result.meta.total).toBe(1);
    });
  });

  describe('createUser', () => {
    it('should create user with Argon2id password and log audit', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // Check existing username
        .mockResolvedValueOnce({
          id: 'new-u1',
          username: 'cashier1',
          displayName: 'Cashier One',
          status: 'ACTIVE',
          userRoles: [],
        }); // getUserById call

      prisma.user.create.mockResolvedValue({
        id: 'new-u1',
        username: 'cashier1',
        displayName: 'Cashier One',
        status: 'ACTIVE',
      });

      const result = await service.createUser(
        {
          username: 'cashier1',
          password: 'Password123!',
          displayName: 'Cashier One',
        },
        { id: 'admin-id', username: 'admin' },
      );

      expect(passwordService.hash).toHaveBeenCalledWith('Password123!');
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE_USER',
          entity: 'USER',
        }),
      );
      expect(result.username).toBe('cashier1');
    });

    it('should throw conflict if username already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });

      await expect(
        service.createUser(
          {
            username: 'existing',
            password: 'Password123!',
            displayName: 'Existing User',
          },
          { id: 'admin-id', username: 'admin' },
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('setUserStatus and Last Admin Safeguard', () => {
    it('should prevent deactivating the last active administrator', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'admin-1',
        username: 'superadmin',
        status: 'ACTIVE',
      });

      prisma.role.findUnique.mockResolvedValue({
        id: 'role-admin-id',
        name: ROLE_ADMIN,
      });

      prisma.userRole.findFirst.mockResolvedValue({
        userId: 'admin-1',
        roleId: 'role-admin-id',
        user: { status: 'ACTIVE' },
      });

      // No other active admins exist
      prisma.userRole.count.mockResolvedValue(0);

      await expect(
        service.setUserStatus('admin-1', false, {
          id: 'admin-1',
          username: 'superadmin',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow deactivating admin when another active admin exists', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'admin-2',
          username: 'secondadmin',
          status: 'ACTIVE',
        })
        .mockResolvedValueOnce({
          id: 'admin-2',
          username: 'secondadmin',
          status: 'DISABLED',
          userRoles: [],
        });

      prisma.role.findUnique.mockResolvedValue({
        id: 'role-admin-id',
        name: ROLE_ADMIN,
      });

      prisma.userRole.findFirst.mockResolvedValue({
        userId: 'admin-2',
        roleId: 'role-admin-id',
        user: { status: 'ACTIVE' },
      });

      // 1 other active admin exists
      prisma.userRole.count.mockResolvedValue(1);

      prisma.user.update.mockResolvedValue({
        id: 'admin-2',
        username: 'secondadmin',
        status: 'DISABLED',
      });

      prisma.refreshToken = {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };

      const result = await service.setUserStatus('admin-2', false, {
        id: 'admin-1',
        username: 'superadmin',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'admin-2' },
        data: { status: 'DISABLED' },
      });
      expect(result.isActive).toBe(false);
    });
  });

  describe('resetPassword', () => {
    it('should reset password with Argon2id and invalidate refresh token', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        username: 'cashier',
      });

      prisma.user.update.mockResolvedValue({ id: 'u1' });
      prisma.refreshToken = {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      };

      const result = await service.resetPassword(
        'u1',
        { newPassword: 'NewSecurePassword123' },
        { id: 'admin-id', username: 'admin' },
      );

      expect(passwordService.hash).toHaveBeenCalledWith('NewSecurePassword123');
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: {
          passwordHash: 'argon2id_mock_hashed_pass',
        },
      });
      expect(result.message).toContain('reset successfully');
    });
  });
});
