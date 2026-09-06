import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { AuthSeedService } from './auth-seed.service';
import { PasswordService } from './password.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config';

describe('AuthSeedService', () => {
  let seedService: AuthSeedService;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let configService: ConfigService<AppConfig>;

  beforeEach(() => {
    prisma = {
      permission: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue([
          { id: 'p1', code: 'dashboard.view' },
          { id: 'p2', code: 'users.view' },
        ]),
      },
      role: {
        upsert: vi.fn().mockResolvedValue({ id: 'role-admin-id', name: 'ADMIN' }),
        findUnique: vi.fn().mockResolvedValue({ id: 'role-admin-id', name: 'ADMIN' }),
      },
      rolePermission: {
        upsert: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      userRole: {
        create: vi.fn(),
      },
    } as unknown as PrismaService;

    passwordService = {
      hash: vi.fn().mockResolvedValue('$argon2id$hashed_admin_password'),
      verify: vi.fn(),
    } as unknown as PasswordService;

    configService = {
      get: vi.fn().mockReturnValue({
        username: 'admin',
        password: 'ExplicitAdminPassword123!',
        displayName: 'System Administrator',
      }),
    } as unknown as ConfigService<AppConfig>;

    seedService = new AuthSeedService(prisma, passwordService, configService);
  });

  it('should seed permissions and ADMIN role idempotently', async () => {
    await seedService.seedPermissionsAndRoles();

    expect(prisma.permission.upsert).toHaveBeenCalled();
    expect(prisma.role.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: 'ADMIN' } }),
    );
    expect(prisma.rolePermission.upsert).toHaveBeenCalled();
  });

  it('should create initial admin user if no admin exists and password is provided', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);
    vi.spyOn(prisma.user, 'create').mockResolvedValue({
      id: 'admin-user-uuid',
      username: 'admin',
    } as any);

    await seedService.seedInitialAdmin();

    expect(passwordService.hash).toHaveBeenCalledWith('ExplicitAdminPassword123!');
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: {
        username: 'admin',
        displayName: 'System Administrator',
        passwordHash: '$argon2id$hashed_admin_password',
        status: 'ACTIVE',
      },
    });
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: {
        userId: 'admin-user-uuid',
        roleId: 'role-admin-id',
      },
    });
  });

  it('should NOT create a duplicate admin if admin already exists', async () => {
    vi.spyOn(prisma.user, 'findUnique').mockResolvedValue({
      id: 'existing-admin-id',
      username: 'admin',
    } as any);

    await seedService.seedInitialAdmin();

    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
