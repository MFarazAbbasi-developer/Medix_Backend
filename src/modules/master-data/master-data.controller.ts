import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MasterDataService } from './master-data.service';
import {
  CreateManufacturerDto,
  UpdateManufacturerDto,
} from './dto/manufacturer.dto';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateUnitDto,
  UpdateUnitDto,
} from './dto/category-unit.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('master-data')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  // --- Manufacturers ---
  @Get('manufacturers')
  @RequirePermissions('products.view')
  async getManufacturers(@Query('includeInactive') includeInactive?: string) {
    return this.masterDataService.getManufacturers(includeInactive === 'true');
  }

  @Post('manufacturers')
  @RequirePermissions('products.create')
  async createManufacturer(
    @Body() dto: CreateManufacturerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.masterDataService.createManufacturer(dto, user?.userId);
  }

  @Patch('manufacturers/:id')
  @RequirePermissions('products.edit')
  async updateManufacturer(
    @Param('id') id: string,
    @Body() dto: UpdateManufacturerDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.masterDataService.updateManufacturer(id, dto, user?.userId);
  }

  // --- Categories ---
  @Get('categories')
  @RequirePermissions('products.view')
  async getCategories(@Query('includeInactive') includeInactive?: string) {
    return this.masterDataService.getCategories(includeInactive === 'true');
  }

  @Post('categories')
  @RequirePermissions('products.create')
  async createCategory(
    @Body() dto: CreateCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.masterDataService.createCategory(dto, user?.userId);
  }

  @Patch('categories/:id')
  @RequirePermissions('products.edit')
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.masterDataService.updateCategory(id, dto, user?.userId);
  }

  // --- Units of Measurement ---
  @Get('units')
  @RequirePermissions('products.view')
  async getUnits(@Query('includeInactive') includeInactive?: string) {
    return this.masterDataService.getUnits(includeInactive === 'true');
  }

  @Post('units')
  @RequirePermissions('products.create')
  async createUnit(
    @Body() dto: CreateUnitDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.masterDataService.createUnit(dto, user?.userId);
  }

  @Patch('units/:id')
  @RequirePermissions('products.edit')
  async updateUnit(
    @Param('id') id: string,
    @Body() dto: UpdateUnitDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.masterDataService.updateUnit(id, dto, user?.userId);
  }
}
