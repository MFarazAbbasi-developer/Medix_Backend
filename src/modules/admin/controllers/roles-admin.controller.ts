import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';
import { RolesAdminService } from '../services/roles-admin.service';
import { CreateRoleDto, UpdateRoleDto } from '../dto/role-admin.dto';

@Controller('admin/roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesAdminController {
  constructor(private readonly rolesAdminService: RolesAdminService) {}

  @Get()
  @RequirePermissions('roles.view')
  async listRoles() {
    return this.rolesAdminService.listRoles();
  }

  @Get('matrix')
  @RequirePermissions('roles.view')
  async getPermissionsMatrix() {
    return this.rolesAdminService.getPermissionsMatrix();
  }

  @Get(':id')
  @RequirePermissions('roles.view')
  async getRoleById(@Param('id') id: string) {
    return this.rolesAdminService.getRoleById(id);
  }

  @Post()
  @RequirePermissions('roles.manage')
  async createRole(@Body() dto: CreateRoleDto, @Req() req: any) {
    return this.rolesAdminService.createRole(dto, req.user);
  }

  @Put(':id')
  @RequirePermissions('roles.manage')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: any,
  ) {
    return this.rolesAdminService.updateRole(id, dto, req.user);
  }

  @Delete(':id')
  @RequirePermissions('roles.manage')
  async deleteRole(@Param('id') id: string, @Req() req: any) {
    return this.rolesAdminService.deleteRole(id, req.user);
  }
}
