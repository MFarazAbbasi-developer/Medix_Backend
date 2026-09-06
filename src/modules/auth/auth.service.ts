import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { PasswordService } from './password.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  LoginResponseDto,
  RefreshResponseDto,
  CurrentUserResponseDto,
} from './dto/auth-response.dto';
import { AppConfig } from '../../config';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig>,
  ) {}

  /**
   * Hashes a raw refresh token using SHA-256 for secure database persistence.
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Authenticates user with username & password.
   * Returns JWT access token and server-persisted refresh token.
   */
  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const sanitizedUsername = loginDto.username.trim().toLowerCase();

    // Find user by unique username
    const user = await this.prisma.user.findUnique({
      where: { username: sanitizedUsername },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Generic error to prevent username enumeration
    const genericAuthError = new UnauthorizedException(
      'Invalid username or password.',
    );

    if (!user) {
      this.logger.warn(`Failed login attempt for non-existent username`);
      throw genericAuthError;
    }

    // Verify password securely using Argon2id
    const isPasswordValid = await this.passwordService.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      this.logger.warn(`Failed login attempt: invalid password for user ID: ${user.id}`);
      throw genericAuthError;
    }

    // Check if user is active
    if (user.status !== 'ACTIVE') {
      this.logger.warn(`Failed login attempt: account disabled for user ID: ${user.id}`);
      throw genericAuthError;
    }

    // Extract roles & permissions
    const roles: string[] = [];
    const permissionsSet = new Set<string>();

    for (const ur of user.userRoles) {
      roles.push(ur.role.name);
      for (const rp of ur.role.rolePermissions) {
        permissionsSet.add(rp.permission.code);
      }
    }
    const permissions = Array.from(permissionsSet);

    // Generate JWT Access Token
    const jwtConfig = this.configService.get<AppConfig['jwt']>('jwt');
    const accessExpiresIn = jwtConfig?.accessExpiresIn || '15m';

    const accessToken = this.jwtService.sign(
      {
        sub: user.id,
        username: user.username,
        displayName: user.displayName,
        roles,
      },
      {
        expiresIn: accessExpiresIn as any,
      },
    );

    // Generate and hash raw refresh token for per-session LAN storage
    const rawRefreshToken = randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);

    const refreshExpiryDays = 7;
    const expiresAt = new Date(
      Date.now() + refreshExpiryDays * 24 * 60 * 60 * 1000,
    );

    // Save refresh session to database
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash,
        deviceInfo: loginDto.deviceInfo || null,
        expiresAt,
      },
    });

    // Update last login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: accessExpiresIn,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        roles,
        permissions,
      },
    };
  }

  /**
   * Refreshes access token with Refresh Token rotation.
   * Revokes old refresh token and creates a new one.
   */
  async refresh(refreshTokenDto: RefreshTokenDto): Promise<RefreshResponseDto> {
    const rawRefreshToken = refreshTokenDto.refreshToken;
    const tokenHash = this.hashToken(rawRefreshToken);

    // Find stored refresh session by hash
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: {
        user: {
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    const invalidSessionError = new UnauthorizedException(
      'Session has expired or is invalid. Please log in again.',
    );

    if (!storedToken) {
      this.logger.warn('Refresh failed: token hash not found');
      throw invalidSessionError;
    }

    if (storedToken.revokedAt !== null) {
      this.logger.warn(
        `Refresh failed: attempt to reuse revoked token for user ID: ${storedToken.userId}`,
      );
      throw invalidSessionError;
    }

    if (storedToken.expiresAt < new Date()) {
      this.logger.warn(
        `Refresh failed: token expired for user ID: ${storedToken.userId}`,
      );
      throw invalidSessionError;
    }

    if (storedToken.user.status !== 'ACTIVE') {
      this.logger.warn(
        `Refresh failed: user is disabled ID: ${storedToken.userId}`,
      );
      throw invalidSessionError;
    }

    // Revoke old token (Refresh Token Rotation)
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new raw refresh token and persist its hash
    const newRawRefreshToken = randomBytes(40).toString('hex');
    const newTokenHash = this.hashToken(newRawRefreshToken);
    const refreshExpiryDays = 7;
    const expiresAt = new Date(
      Date.now() + refreshExpiryDays * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        userId: storedToken.userId,
        tokenHash: newTokenHash,
        deviceInfo: refreshTokenDto.deviceInfo || storedToken.deviceInfo,
        expiresAt,
      },
    });

    // Generate new JWT Access Token
    const jwtConfig = this.configService.get<AppConfig['jwt']>('jwt');
    const accessExpiresIn = jwtConfig?.accessExpiresIn || '15m';
    const roles = storedToken.user.userRoles.map((ur) => ur.role.name);

    const accessToken = this.jwtService.sign(
      {
        sub: storedToken.user.id,
        username: storedToken.user.username,
        displayName: storedToken.user.displayName,
        roles,
      },
      {
        expiresIn: accessExpiresIn as any,
      },
    );

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      expiresIn: accessExpiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Revokes the current client session's refresh token.
   * Multi-PC LAN isolation: only revokes the current station's session.
   */
  async logout(refreshTokenDto: RefreshTokenDto): Promise<{ success: boolean }> {
    const rawRefreshToken = refreshTokenDto.refreshToken;
    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
    });

    if (storedToken && storedToken.revokedAt === null) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
    }

    return { success: true };
  }

  /**
   * Retrieves authenticated user's profile, roles, and granted permissions.
   */
  async getMe(userId: string): Promise<CurrentUserResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User account is invalid or deactivated');
    }

    const roles: string[] = [];
    const permissionsSet = new Set<string>();

    for (const ur of user.userRoles) {
      roles.push(ur.role.name);
      for (const rp of ur.role.rolePermissions) {
        permissionsSet.add(rp.permission.code);
      }
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      status: user.status,
      roles,
      permissions: Array.from(permissionsSet),
      lastLoginAt: user.lastLoginAt,
    };
  }
}
