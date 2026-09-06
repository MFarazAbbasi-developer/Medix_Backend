import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ExpiryService } from './expiry.service';
import {
  QueryExpiryDto,
  QueryExpiryMetricsDto,
} from './dto/query-expiry.dto';
import {
  QuarantineMoveDto,
  QuarantineReleaseDto,
} from './dto/quarantine-move.dto';
import { CreateRecallDto } from './dto/create-recall.dto';
import { UpdateRecallStatusDto } from './dto/update-recall-status.dto';
import { QueryRecallDto } from './dto/query-recall.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('expiry')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExpiryController {
  constructor(private readonly expiryService: ExpiryService) {}

  // ------------------------------------------
  // Expiry Management
  // ------------------------------------------

  @Get('metrics')
  @RequirePermissions('expiry.view')
  async getMetrics(@Query() dto: QueryExpiryMetricsDto) {
    return this.expiryService.getExpiryMetrics(dto);
  }

  @Get('batches')
  @RequirePermissions('expiry.view')
  async getExpiringBatches(@Query() dto: QueryExpiryDto) {
    return this.expiryService.getExpiringBatches(dto);
  }

  @Get('batches/:batchId/breakdown')
  @RequirePermissions('expiry.view')
  async getBatchStockBreakdown(
    @Param('batchId') batchId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.expiryService.getBatchStockBreakdown(batchId, branchId);
  }

  // ------------------------------------------
  // Quarantine Operations
  // ------------------------------------------

  @Get('quarantine/stock')
  @RequirePermissions('quarantine.view')
  async getQuarantineInventory(
    @Query('branchId') branchId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('productId') productId?: string,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.expiryService.getQuarantineInventory({
      branchId,
      warehouseId,
      productId,
      search,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Post('quarantine/move')
  @RequirePermissions('quarantine.manage')
  async moveStockToQuarantine(
    @Body() dto: QuarantineMoveDto,
    @Req() req: any,
  ) {
    return this.expiryService.moveStockToQuarantine(dto, req.user?.id);
  }

  @Post('quarantine/release')
  @RequirePermissions('quarantine.manage')
  async releaseQuarantineStock(
    @Body() dto: QuarantineReleaseDto,
    @Req() req: any,
  ) {
    return this.expiryService.releaseQuarantineStock(dto, req.user?.id);
  }

  // ------------------------------------------
  // Product Recalls
  // ------------------------------------------

  @Get('recalls')
  @RequirePermissions('recalls.view')
  async getRecalls(@Query() dto: QueryRecallDto) {
    return this.expiryService.getRecalls(dto);
  }

  @Get('recalls/:id')
  @RequirePermissions('recalls.view')
  async getRecallById(@Param('id') id: string) {
    return this.expiryService.getRecallById(id);
  }

  @Post('recalls')
  @RequirePermissions('recalls.manage')
  async createRecall(@Body() dto: CreateRecallDto, @Req() req: any) {
    return this.expiryService.createRecall(dto, req.user?.id);
  }

  @Patch('recalls/:id/status')
  @RequirePermissions('recalls.manage')
  async updateRecallStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRecallStatusDto,
    @Req() req: any,
  ) {
    return this.expiryService.updateRecallStatus(id, dto, req.user?.id);
  }

  @Post('recalls/:id/quarantine-stock')
  @RequirePermissions('recalls.manage')
  async quarantineRecalledStock(
    @Param('id') id: string,
    @Req() req: any,
    @Body('quarantineWarehouseId') quarantineWarehouseId?: string,
  ) {
    return this.expiryService.quarantineRecalledStock(
      id,
      quarantineWarehouseId,
      req.user?.id,
    );
  }
}
