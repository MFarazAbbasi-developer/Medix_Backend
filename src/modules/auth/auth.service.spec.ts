import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config';

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: PrismaService;
  let passwordService: PasswordService;
  let jwtService: JwtService;
  let configService: ConfigService<AppConfig>;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      refreshToken: {
        create: vi.fn(),
        findFirst: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as PrismaService;

    passwordService = {
      hash: vi.fn(),
      verify: vi.fn(),
    } as unknown as PasswordService;

    jwtService = {
      sign: vi.fn().mockReturnValue('mock_jwt_access_token'),
    } as unknown as JwtService;

    configService = {
      get: vi.fn().mockReturnValue({
        accessSecret: 'test_access_secret_min_16_chars',
        accessExpiresIn: '15m',
        refreshSecret: 'test_refresh_secret_min_16_chars',
        refreshExpiresIn: '7d',
      }),
    } as unknown as ConfigService<AppConfig>;

    authService = new AuthService(
      prisma,
      passwordService,
      jwtService,
      configService,
    );
  });

  describe('login', () => {
    const mockUser = {
      id: 'user-uuid-1',
      username: 'admin',
      displayName: 'Administrator',
      passwordHash: '$argon2id$mockhash',
      status: 'ACTIVE',
      userRoles: [
        {
          role: {
            name: 'ADMIN',
            rolePermissions: [
              { permission: { code: 'dashboard.view' } },
              { permission: { code: 'sales.create' } },
            ],
          },
        },
      ],
    };

    it('should login successfully with valid credentials and return tokens', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);
      vi.spyOn(passwordService, 'verify').mockResolvedValue(true);
      vi.spyOn(prisma.refreshToken, 'create').mockResolvedValue({ id: 'rt-1' } as any);
      vi.spyOn(prisma.user, 'update').mockResolvedValue(mockUser as any);

      const result = await authService.login({
        username: 'admin',
        password: 'ValidPassword123!',
        deviceInfo: 'Electron Station #1',
      });

      expect(result.accessToken).toBe('mock_jwt_access_token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.id).toBe('user-uuid-1');
      expect(result.user.roles).toContain('ADMIN');
      expect(result.user.permissions).toContain('dashboard.view');
      expect(result.user.permissions).toContain('sales.create');
      expect((result.user as any).passwordHash).toBeUndefined();
    });

    it('should throw UnauthorizedException for non-existent username without revealing existence', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      await expect(
        authService.login({
          username: 'nonexistent',
          password: 'SomePassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw generic UnauthorizedException for invalid password', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);
      vi.spyOn(passwordService, 'verify').mockResolvedValue(false);

      await expect(
        authService.login({
          username: 'admin',
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject login if user account is DISABLED', async () => {
      const disabledUser = { ...mockUser, status: 'DISABLED' };
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(disabledUser as any);
      vi.spyOn(passwordService, 'verify').mockResolvedValue(true);

      await expect(
        authService.login({
          username: 'admin',
          password: 'ValidPassword123!',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh token rotation', () => {
    it('should rotate refresh token and return new token pair', async () => {
      const rawOldToken = 'raw_old_refresh_token_string';
      const tokenHash = authService.hashToken(rawOldToken);

      const mockStoredToken = {
        id: 'rt-record-1',
        userId: 'user-uuid-1',
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000), // 1 day in future
        revokedAt: null,
        deviceInfo: 'Station #1',
        user: {
          id: 'user-uuid-1',
          username: 'admin',
          displayName: 'Admin',
          status: 'ACTIVE',
          userRoles: [{ role: { name: 'ADMIN' } }],
        },
      };

      vi.spyOn(prisma.refreshToken, 'findFirst').mockResolvedValue(mockStoredToken as any);
      vi.spyOn(prisma.refreshToken, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.refreshToken, 'create').mockResolvedValue({ id: 'rt-record-2' } as any);

      const result = await authService.refresh({
        refreshToken: rawOldToken,
      });

      expect(result.accessToken).toBe('mock_jwt_access_token');
      expect(result.refreshToken).toBeDefined();
      expect(result.refreshToken).not.toBe(rawOldToken);

      // Verify old token was revoked
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-record-1' },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should reject refresh if token was already revoked', async () => {
      const rawToken = 'revoked_token';
      const tokenHash = authService.hashToken(rawToken);

      const mockStoredToken = {
        id: 'rt-record-1',
        userId: 'user-uuid-1',
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: new Date(), // Already revoked
        user: { id: 'user-uuid-1', status: 'ACTIVE', userRoles: [] },
      };

      vi.spyOn(prisma.refreshToken, 'findFirst').mockResolvedValue(mockStoredToken as any);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should reject refresh if user is DISABLED', async () => {
      const rawToken = 'valid_token_disabled_user';
      const tokenHash = authService.hashToken(rawToken);

      const mockStoredToken = {
        id: 'rt-record-1',
        userId: 'user-uuid-1',
        tokenHash,
        expiresAt: new Date(Date.now() + 86400000),
        revokedAt: null,
        user: { id: 'user-uuid-1', status: 'DISABLED', userRoles: [] },
      };

      vi.spyOn(prisma.refreshToken, 'findFirst').mockResolvedValue(mockStoredToken as any);

      await expect(
        authService.refresh({ refreshToken: rawToken }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke the specified session refresh token', async () => {
      const rawToken = 'active_session_token';
      const tokenHash = authService.hashToken(rawToken);

      vi.spyOn(prisma.refreshToken, 'findFirst').mockResolvedValue({
        id: 'rt-session-a',
        tokenHash,
        revokedAt: null,
      } as any);
      vi.spyOn(prisma.refreshToken, 'update').mockResolvedValue({} as any);

      const result = await authService.logout({ refreshToken: rawToken });

      expect(result).toEqual({ success: true });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-session-a' },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('getMe', () => {
    it('should return user details and unique permissions list', async () => {
      const mockUser = {
        id: 'user-uuid-1',
        username: 'sales_user',
        displayName: 'Sales Officer',
        status: 'ACTIVE',
        lastLoginAt: new Date(),
        userRoles: [
          {
            role: {
              name: 'OPERATOR',
              rolePermissions: [
                { permission: { code: 'sales.view' } },
                { permission: { code: 'sales.create' } },
              ],
            },
          },
        ],
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(mockUser as any);

      const result = await authService.getMe('user-uuid-1');

      expect(result.id).toBe('user-uuid-1');
      expect(result.username).toBe('sales_user');
      expect(result.roles).toEqual(['OPERATOR']);
      expect(result.permissions).toContain('sales.view');
      expect(result.permissions).toContain('sales.create');
      expect((result as any).passwordHash).toBeUndefined();
    });
  });
});
