import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('warehouses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class WarehouseController {
  constructor(private readonly warehouseService: WarehouseService) {}

  @Get()
  @RequirePermissions('warehouses.view', 'inventory.view')
  async getWarehouses(
    @Query('branchId') branchId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.warehouseService.getWarehouses(
      branchId,
      includeInactive === 'true',
    );
  }

  @Get(':id')
  @RequirePermissions('warehouses.view', 'inventory.view')
  async getWarehouseById(@Param('id') id: string) {
    return this.warehouseService.getWarehouseById(id);
  }

  @Post()
  @RequirePermissions('warehouses.manage')
  async createWarehouse(
    @Body() dto: CreateWarehouseDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.warehouseService.createWarehouse(dto, user?.userId);
  }

  @Patch(':id')
  @RequirePermissions('warehouses.manage')
  async updateWarehouse(
    @Param('id') id: string,
    @Body() dto: UpdateWarehouseDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.warehouseService.updateWarehouse(id, dto, user?.userId);
  }
}
