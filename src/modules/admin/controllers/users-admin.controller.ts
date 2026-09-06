import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';
import { UsersAdminService } from '../services/users-admin.service';
import {
  CreateUserDto,
  UpdateUserDto,
  ResetPasswordDto,
  UpdateUserStatusDto,
  QueryUserDto,
} from '../dto/user-admin.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersAdminController {
  constructor(private readonly usersAdminService: UsersAdminService) {}

  @Get()
  @RequirePermissions('users.view')
  async listUsers(@Query() query: QueryUserDto) {
    return this.usersAdminService.listUsers(query);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  async getUserById(@Param('id') id: string) {
    return this.usersAdminService.getUserById(id);
  }

  @Post()
  @RequirePermissions('users.manage')
  async createUser(@Body() dto: CreateUserDto, @Req() req: any) {
    return this.usersAdminService.createUser(dto, req.user);
  }

  @Put(':id')
  @RequirePermissions('users.manage')
  async updateUser(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: any,
  ) {
    return this.usersAdminService.updateUser(id, dto, req.user);
  }

  @Patch(':id/status')
  @RequirePermissions('users.manage')
  async setUserStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @Req() req: any,
  ) {
    return this.usersAdminService.setUserStatus(id, dto.isActive, req.user);
  }

  @Post(':id/reset-password')
  @RequirePermissions('users.manage')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPasswordDto,
    @Req() req: any,
  ) {
    return this.usersAdminService.resetPassword(id, dto, req.user);
  }
}
