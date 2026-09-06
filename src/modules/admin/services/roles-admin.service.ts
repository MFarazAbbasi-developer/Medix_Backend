import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { ROLE_ADMIN, INITIAL_PERMISSIONS } from '../../auth/constants';
import { CreateRoleDto, UpdateRoleDto } from '../dto/role-admin.dto';

export interface PermissionGroup {
  module: string;
  permissions: {
    code: string;
    description: string;
  }[];
}

@Injectable()
export class RolesAdminService {
  private readonly logger = new Logger(RolesAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Derives human-friendly module name from permission code prefix.
   */
  private getModuleName(code: string): string {
    const prefix = code.split('.')[0];
    const map: Record<string, string> = {
      dashboard: 'Dashboard',
      users: 'User Management',
      roles: 'Role & Permission Management',
      settings: 'Settings & Configuration',
      products: 'Products & Catalog',
      inventory: 'Inventory & Stock Management',
      purchasing: 'Purchasing & GRN',
      sales: 'Sales & Invoicing',
      payments: 'Payments & Receipts',
      returns: 'Sales & Purchase Returns',
      pricing: 'Pricing & Price Lists',
      schemes: 'Promotions & Schemes',
      transfers: 'Stock Transfers',
      expiry: 'Expiry Management',
      quarantine: 'Quarantine Operations',
      recalls: 'Product Recalls',
      reports: 'Reports & Analytics',
      audit: 'Audit Trail',
      backup: 'Database Backup & Restore',
      data: 'Data Export',
    };
    return map[prefix] || 'General';
  }

  /**
   * List all roles with user count and permission count.
   */
  async listRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            userRoles: true,
            rolePermissions: true,
          },
        },
        rolePermissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.name === ROLE_ADMIN,
      usersCount: role._count.userRoles,
      permissionsCount: role._count.rolePermissions,
      permissions: role.rolePermissions.map((rp) => rp.permission.code).sort(),
    }));
  }

  /**
   * Get role by ID with permissions.
   */
  async getRoleById(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        rolePermissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: { userRoles: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID "${id}" not found.`);
    }

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystem: role.name === ROLE_ADMIN,
      usersCount: role._count.userRoles,
      permissions: role.rolePermissions.map((rp) => ({
        id: rp.permission.id,
        code: rp.permission.code,
        description: rp.permission.description,
      })),
    };
  }

  /**
   * Get grouped permission matrix with all available system permissions
   * and mapped roles.
   */
  async getPermissionsMatrix() {
    // Ensure all INITIAL_PERMISSIONS exist in database
    const dbPermissions = await this.prisma.permission.findMany({
      orderBy: { code: 'asc' },
    });

    const groupsMap = new Map<string, { code: string; description: string }[]>();

    for (const perm of dbPermissions) {
      const moduleName = this.getModuleName(perm.code);
      if (!groupsMap.has(moduleName)) {
        groupsMap.set(moduleName, []);
      }
      groupsMap.get(moduleName)!.push({
        code: perm.code,
        description: perm.description || '',
      });
    }

    const groups: PermissionGroup[] = Array.from(groupsMap.entries()).map(
      ([module, permissions]) => ({
        module,
        permissions,
      }),
    );

    const roles = await this.listRoles();

    return {
      groups,
      roles,
    };
  }

  /**
   * Create a new custom role.
   */
  async createRole(
    dto: CreateRoleDto,
    actor: { id: string; username: string },
  ) {
    const name = dto.name.trim().toUpperCase();

    const existing = await this.prisma.role.findUnique({
      where: { name },
    });

    if (existing) {
      throw new ConflictException(`Role with name "${name}" already exists.`);
    }

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: dto.permissionCodes } },
    });

    if (permissions.length !== dto.permissionCodes.length) {
      throw new BadRequestException(
        'One or more specified permission codes are invalid.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name,
          description: dto.description?.trim() || null,
        },
      });

      if (permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: permissions.map((p) => ({
            roleId: role.id,
            permissionId: p.id,
          })),
        });
      }

      return role;
    });

    await this.auditService.log({
      userId: actor.id,
      action: 'CREATE_ROLE',
      entity: 'ROLE',
      entityId: created.id,
      details: {
        roleName: created.name,
        permissionCodes: dto.permissionCodes,
      },
    });

    return this.getRoleById(created.id);
  }

  /**
   * Update an existing role.
   */
  async updateRole(
    id: string,
    dto: UpdateRoleDto,
    actor: { id: string; username: string },
  ) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      include: { rolePermissions: { include: { permission: true } } },
    });

    if (!existing) {
      throw new NotFoundException(`Role with ID "${id}" not found.`);
    }

    // Protect ADMIN role from losing essential administrative authority
    if (existing.name === ROLE_ADMIN && dto.permissionCodes) {
      const criticalPermissions = ['users.manage', 'roles.manage', 'backup.manage', 'backup.restore'];
      const missingCritical = criticalPermissions.filter(
        (code) => !dto.permissionCodes!.includes(code),
      );
      if (missingCritical.length > 0) {
        throw new BadRequestException(
          `System role ADMIN must retain critical administrative permissions: ${missingCritical.join(', ')}`,
        );
      }
    }

    // Role rename protection: cannot rename ADMIN
    if (existing.name === ROLE_ADMIN && dto.name && dto.name.toUpperCase() !== ROLE_ADMIN) {
      throw new BadRequestException('Cannot rename the system ADMIN role.');
    }

    await this.prisma.$transaction(async (tx) => {
      const updateData: { name?: string; description?: string | null } = {};
      if (dto.name) {
        updateData.name = dto.name.trim().toUpperCase();
      }
      if (dto.description !== undefined) {
        updateData.description = dto.description ? dto.description.trim() : null;
      }

      await tx.role.update({
        where: { id },
        data: updateData,
      });

      if (dto.permissionCodes) {
        const permissions = await tx.permission.findMany({
          where: { code: { in: dto.permissionCodes } },
        });

        if (permissions.length !== dto.permissionCodes.length) {
          throw new BadRequestException(
            'One or more specified permission codes are invalid.',
          );
        }

        await tx.rolePermission.deleteMany({
          where: { roleId: id },
        });

        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((p) => ({
              roleId: id,
              permissionId: p.id,
            })),
          });
        }
      }
    });

    await this.auditService.log({
      userId: actor.id,
      action: 'UPDATE_ROLE',
      entity: 'ROLE',
      entityId: id,
      details: {
        roleName: existing.name,
        updatedFields: Object.keys(dto),
      },
    });

    return this.getRoleById(id);
  }

  /**
   * Delete a role.
   */
  async deleteRole(id: string, actor: { id: string; username: string }) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        _count: {
          select: { userRoles: true },
        },
      },
    });

    if (!role) {
      throw new NotFoundException(`Role with ID "${id}" not found.`);
    }

    if (role.name === ROLE_ADMIN) {
      throw new BadRequestException('Cannot delete the system ADMIN role.');
    }

    if (role._count.userRoles > 0) {
      throw new BadRequestException(
        `Cannot delete role "${role.name}" because it is currently assigned to ${role._count.userRoles} user(s).`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      await tx.role.delete({ where: { id } });
    });

    await this.auditService.log({
      userId: actor.id,
      action: 'DELETE_ROLE',
      entity: 'ROLE',
      entityId: id,
      details: {
        roleName: role.name,
      },
    });

    return { message: `Role "${role.name}" deleted successfully.` };
  }
}
