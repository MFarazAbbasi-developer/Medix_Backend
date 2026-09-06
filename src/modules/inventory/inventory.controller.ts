import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateStockAdjustmentDto } from './dto/create-adjustment.dto';
import { CreateOpeningBalanceDto } from './dto/opening-balance.dto';
import { QueryInventorySummaryDto } from './dto/query-inventory.dto';
import { QueryStockLedgerDto } from './dto/query-ledger.dto';
import { FefoPreviewDto } from './dto/fefo-preview.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';
import { StockAdjustmentStatus } from '@prisma/client';

@Controller('inventory')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('summary')
  @RequirePermissions('inventory.view')
  async getInventorySummary(@Query() query: QueryInventorySummaryDto) {
    return this.inventoryService.getInventorySummary(query);
  }

  @Get('product/:productId')
  @RequirePermissions('inventory.view')
  async getProductStockDetails(
    @Param('productId') productId: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.inventoryService.getProductStockDetails(productId, warehouseId);
  }

  @Get('ledger')
  @RequirePermissions('inventory.ledger_view')
  async getStockLedger(@Query() query: QueryStockLedgerDto) {
    return this.inventoryService.getStockLedger(query);
  }

  @Post('fefo-preview')
  @RequirePermissions('inventory.view')
  async previewFefoAllocation(@Body() dto: FefoPreviewDto) {
    return this.inventoryService.previewFefoAllocation(dto);
  }

  @Post('opening-balance')
  @RequirePermissions('inventory.adjust')
  async createOpeningBalance(
    @Body() dto: CreateOpeningBalanceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.inventoryService.createOpeningBalance(dto, user?.userId);
  }

  @Get('adjustments')
  @RequirePermissions('inventory.adjust')
  async getStockAdjustments(
    @Query('warehouseId') warehouseId?: string,
    @Query('status') status?: StockAdjustmentStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventoryService.getStockAdjustments(
      warehouseId,
      status,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Post('adjustments')
  @RequirePermissions('inventory.adjust')
  async createStockAdjustment(
    @Body() dto: CreateStockAdjustmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.inventoryService.createStockAdjustment(dto, user?.userId);
  }

  @Post('adjustments/:id/post')
  @RequirePermissions('inventory.adjust')
  async postStockAdjustment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.inventoryService.postStockAdjustment(id, user?.userId);
  }

  @Post('adjustments/:id/reverse')
  @RequirePermissions('inventory.adjust')
  async reverseStockAdjustment(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.inventoryService.reverseStockAdjustment(id, user?.userId);
  }
}
