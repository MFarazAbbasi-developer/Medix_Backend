import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PasswordService } from '../../auth/password.service';
import { AuditService } from '../../audit/audit.service';
import { ROLE_ADMIN } from '../../auth/constants';
import {
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
  QueryUserDto,
} from '../dto/user-admin.dto';
import { Prisma, UserStatus } from '@prisma/client';

@Injectable()
export class UsersAdminService {
  private readonly logger = new Logger(UsersAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Returns a sanitized projection of user fields (excluding password hash).
   */
  private sanitizeUser(user: any) {
    const { passwordHash, ...sanitized } = user;
    return {
      ...sanitized,
      isActive: user.status === UserStatus.ACTIVE,
    };
  }

  /**
   * Helper to verify if an active administrator exists besides the target user.
   */
  private async ensureNotLastAdmin(targetUserId: string): Promise<void> {
    const adminRole = await this.prisma.role.findUnique({
      where: { name: ROLE_ADMIN },
    });

    if (!adminRole) return;

    // Check if target user has ADMIN role
    const targetUserAdminRole = await this.prisma.userRole.findFirst({
      where: {
        userId: targetUserId,
        roleId: adminRole.id,
      },
      include: { user: true },
    });

    if (!targetUserAdminRole || targetUserAdminRole.user.status !== UserStatus.ACTIVE) {
      // User is not an active admin, so disabling/modifying them won't remove the last admin
      return;
    }

    // Count other active administrators
    const otherActiveAdminsCount = await this.prisma.userRole.count({
      where: {
        roleId: adminRole.id,
        userId: { not: targetUserId },
        user: { status: UserStatus.ACTIVE },
      },
    });

    if (otherActiveAdminsCount === 0) {
      throw new BadRequestException(
        'Operation prohibited: Cannot disable or remove administrator role from the last active administrator account.',
      );
    }
  }

  /**
   * List users with pagination, search, and filtering.
   */
  async listUsers(query: QueryUserDto) {
    const page = query.page || 1;
    const limit = query.limit || 50;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {};

    if (query.isActive !== undefined) {
      where.status = query.isActive ? UserStatus.ACTIVE : UserStatus.DISABLED;
    }

    if (query.search) {
      where.OR = [
        { username: { contains: query.search, mode: 'insensitive' } },
        { displayName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.roleId) {
      where.userRoles = {
        some: { roleId: query.roleId },
      };
    }

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          userRoles: {
            include: {
              role: true,
            },
          },
        },
      }),
    ]);

    const items = users.map((u) => {
      const sanitized = this.sanitizeUser(u);
      return {
        ...sanitized,
        roles: u.userRoles.map((ur) => ({
          id: ur.role.id,
          name: ur.role.name,
          description: ur.role.description,
        })),
      };
    });

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single user by ID with assigned roles and derived permissions.
   */
  async getUserById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
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

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }

    const permissionsSet = new Set<string>();
    const roles = user.userRoles.map((ur) => {
      ur.role.rolePermissions.forEach((rp) => {
        permissionsSet.add(rp.permission.code);
      });
      return {
        id: ur.role.id,
        name: ur.role.name,
        description: ur.role.description,
      };
    });

    const sanitized = this.sanitizeUser(user);

    return {
      ...sanitized,
      roles,
      permissions: Array.from(permissionsSet).sort(),
    };
  }

  /**
   * Create a new user with Argon2id hashed password and role assignment.
   */
  async createUser(
    dto: CreateUserDto,
    actor: { id: string; username: string },
  ) {
    const username = dto.username.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      throw new ConflictException(
        `User with username "${username}" already exists.`,
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username,
          passwordHash,
          displayName: dto.displayName.trim(),
          status: UserStatus.ACTIVE,
        },
      });

      if (dto.roleIds && dto.roleIds.length > 0) {
        // Validate all role IDs
        const roles = await tx.role.findMany({
          where: { id: { in: dto.roleIds } },
        });

        if (roles.length !== dto.roleIds.length) {
          throw new BadRequestException('One or more specified roles do not exist.');
        }

        await tx.userRole.createMany({
          data: dto.roleIds.map((roleId) => ({
            userId: created.id,
            roleId,
          })),
        });
      }

      return created;
    });

    await this.auditService.log({
      userId: actor.id,
      action: 'CREATE_USER',
      entity: 'USER',
      entityId: user.id,
      details: {
        username: user.username,
        displayName: user.displayName,
        assignedRoles: dto.roleIds || [],
      },
    });

    return this.getUserById(user.id);
  }

  /**
   * Update an existing user's details and role assignments.
   */
  async updateUser(
    id: string,
    dto: UpdateUserDto,
    actor: { id: string; username: string },
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { userRoles: { include: { role: true } } },
    });

    if (!existing) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }

    // If changing roles, verify we are not removing ADMIN from the last active admin
    if (dto.roleIds) {
      const adminRole = await this.prisma.role.findUnique({
        where: { name: ROLE_ADMIN },
      });

      const currentlyHasAdmin = existing.userRoles.some(
        (ur) => ur.role.name === ROLE_ADMIN,
      );
      const willHaveAdmin = adminRole
        ? dto.roleIds.includes(adminRole.id)
        : false;

      if (currentlyHasAdmin && !willHaveAdmin) {
        await this.ensureNotLastAdmin(id);
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const updateData: Prisma.UserUpdateInput = {};
      if (dto.displayName !== undefined) {
        updateData.displayName = dto.displayName.trim();
      }

      await tx.user.update({
        where: { id },
        data: updateData,
      });

      if (dto.roleIds) {
        const roles = await tx.role.findMany({
          where: { id: { in: dto.roleIds } },
        });
        if (roles.length !== dto.roleIds.length) {
          throw new BadRequestException('One or more specified roles do not exist.');
        }

        await tx.userRole.deleteMany({
          where: { userId: id },
        });

        if (dto.roleIds.length > 0) {
          await tx.userRole.createMany({
            data: dto.roleIds.map((roleId) => ({
              userId: id,
              roleId,
            })),
          });
        }
      }
    });

    await this.auditService.log({
      userId: actor.id,
      action: 'UPDATE_USER',
      entity: 'USER',
      entityId: id,
      details: {
        updatedFields: Object.keys(dto),
        targetUsername: existing.username,
      },
    });

    return this.getUserById(id);
  }

  /**
   * Activate or deactivate a user.
   */
  async setUserStatus(
    id: string,
    isActive: boolean,
    actor: { id: string; username: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }

    if (!isActive) {
      // Disabling user: protect last active admin
      await this.ensureNotLastAdmin(id);
    }

    const newStatus = isActive ? UserStatus.ACTIVE : UserStatus.DISABLED;

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.user.update({
        where: { id },
        data: {
          status: newStatus,
        },
      });

      if (!isActive) {
        // Revoke active refresh tokens immediately
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return res;
    });

    await this.auditService.log({
      userId: actor.id,
      action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      entity: 'USER',
      entityId: id,
      details: {
        username: user.username,
        previousStatus: user.status,
        newStatus,
      },
    });

    return this.getUserById(updated.id);
  }

  /**
   * Reset / change a user's password using Argon2id.
   * Revokes active refresh tokens to force re-login.
   */
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
    actor: { id: string; username: string },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID "${id}" not found.`);
    }

    const passwordHash = await this.passwordService.hash(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          passwordHash,
        },
      });

      // Revoke all existing refresh tokens
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.auditService.log({
      userId: actor.id,
      action: 'RESET_PASSWORD',
      entity: 'USER',
      entityId: id,
      details: {
        username: user.username,
        resetBy: actor.username,
      },
    });

    return {
      message: `Password for user "${user.username}" reset successfully. Active sessions invalidated.`,
    };
  }
}
