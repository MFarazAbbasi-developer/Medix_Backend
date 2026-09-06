import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OrganizationService } from './organization.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('organization')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  @RequirePermissions('settings.view')
  async getOrganization() {
    return this.organizationService.getOrganization();
  }

  @Patch()
  @RequirePermissions('settings.manage')
  async updateOrganization(
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationService.updateOrganization(dto, user?.userId);
  }

  @Get('branches')
  @RequirePermissions('settings.view')
  async getBranches() {
    return this.organizationService.getBranches();
  }

  @Get('branches/:id')
  @RequirePermissions('settings.view')
  async getBranchById(@Param('id') id: string) {
    return this.organizationService.getBranchById(id);
  }

  @Post('branches')
  @RequirePermissions('settings.manage')
  async createBranch(
    @Body() dto: CreateBranchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationService.createBranch(dto, user?.userId);
  }

  @Patch('branches/:id')
  @RequirePermissions('settings.manage')
  async updateBranch(
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationService.updateBranch(id, dto, user?.userId);
  }

  @Delete('branches/:id')
  @RequirePermissions('settings.manage')
  async deleteBranch(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.organizationService.deleteBranch(id, user?.userId);
  }
}
