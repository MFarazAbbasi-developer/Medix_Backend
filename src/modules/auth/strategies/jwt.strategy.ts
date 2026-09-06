import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config';
import { CurrentUserPayload } from '../dto/current-user.dto';
import { PrismaService } from '../../../prisma/prisma.service';

export interface JwtAccessPayload {
  sub: string;
  username: string;
  displayName: string;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService<AppConfig>,
    private readonly prisma: PrismaService,
  ) {
    const config = configService.get<AppConfig['jwt']>('jwt') || {
      accessSecret: 'medix_dev_access_secret_key_farmax_2026_local',
      accessExpiresIn: '15m',
      refreshSecret: 'medix_dev_refresh_secret_key_farmax_2026_local',
      refreshExpiresIn: '7d',
    };

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.accessSecret,
    });
  }

  async validate(payload: JwtAccessPayload): Promise<CurrentUserPayload> {
    // Verify user exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
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
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      roles,
      permissions: Array.from(permissionsSet),
    };
  }
}
