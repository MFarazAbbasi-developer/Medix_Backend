import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PurchaseReturnService } from './purchase-return.service';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto';
import { QueryPurchaseReturnDto } from './dto/query-purchase-return.dto';
import { CancelPurchaseReturnDto } from './dto/cancel-purchase-return.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('purchase-returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchaseReturnController {
  constructor(private readonly returnService: PurchaseReturnService) {}

  @Get('returnable-grn/:grnId')
  @RequirePermissions('returns.view')
  async getReturnableGrn(@Param('grnId') grnId: string) {
    return this.returnService.getReturnableGrn(grnId);
  }

  @Get('returnable-batches')
  @RequirePermissions('returns.view')
  async getReturnableBatches(
    @Query('supplierId') supplierId?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('search') search?: string,
  ) {
    return this.returnService.getReturnableBatches({
      supplierId,
      warehouseId,
      search,
    });
  }

  @Get(':id/challan')
  @RequirePermissions('returns.view')
  async getChallan(@Param('id') id: string) {
    return this.returnService.getChallan(id);
  }

  @Get()
  @RequirePermissions('returns.view')
  async findAll(@Query() query: QueryPurchaseReturnDto) {
    return this.returnService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('returns.view')
  async findOne(@Param('id') id: string) {
    return this.returnService.findById(id);
  }

  @Post()
  @RequirePermissions('returns.create')
  async create(
    @Body() dto: CreatePurchaseReturnDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.returnService.createPurchaseReturn(dto, user?.userId);
  }

  @Post(':id/dispatch')
  @RequirePermissions('returns.dispatch_challan')
  async dispatch(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.returnService.dispatchPurchaseReturn(id, user?.userId);
  }

  @Post(':id/complete')
  @RequirePermissions('returns.post_debit_note')
  async complete(
    @Param('id') id: string,
    @Body() dto: { vendorCreditNoteNumber?: string },
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.returnService.completePurchaseReturn(id, dto, user?.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('returns.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelPurchaseReturnDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.returnService.cancelPurchaseReturn(id, dto, user?.userId);
  }
}
