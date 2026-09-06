import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';
import { GrnService } from './grn.service';
import { CreatePurchaseOrderDto } from './dto/create-po.dto';
import { UpdatePurchaseOrderDto } from './dto/update-po.dto';
import { QueryPurchaseOrderDto } from './dto/query-po.dto';
import { CreateGoodsReceiveNoteDto } from './dto/create-grn.dto';
import { UpdateGoodsReceiveNoteDto } from './dto/update-grn.dto';
import { QueryGoodsReceiveNoteDto } from './dto/query-grn.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('purchases')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PurchasingController {
  constructor(
    private readonly poService: PurchaseOrderService,
    private readonly grnService: GrnService,
  ) {}

  // ==========================================
  // PURCHASE ORDERS
  // ==========================================

  @Get('orders')
  @RequirePermissions('purchases.view')
  async findAllOrders(@Query() query: QueryPurchaseOrderDto) {
    return this.poService.findAll(query);
  }

  @Get('orders/:id')
  @RequirePermissions('purchases.view')
  async findOrderById(@Param('id') id: string) {
    return this.poService.findById(id);
  }

  @Post('orders')
  @RequirePermissions('purchases.create')
  async createOrder(
    @Body() dto: CreatePurchaseOrderDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.poService.create(dto, user?.userId);
  }

  @Put('orders/:id')
  @RequirePermissions('purchases.edit')
  async updateOrder(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.poService.update(id, dto, user?.userId);
  }

  @Post('orders/:id/issue')
  @RequirePermissions('purchases.edit')
  async issueOrder(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.poService.issue(id, user?.userId);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('purchases.cancel')
  async cancelOrder(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.poService.cancel(id, user?.userId);
  }

  // ==========================================
  // GOODS RECEIVE NOTES (GRN)
  // ==========================================

  @Get('grn')
  @RequirePermissions('purchases.view')
  async findAllGrn(@Query() query: QueryGoodsReceiveNoteDto) {
    return this.grnService.findAll(query);
  }

  @Get('grn/:id')
  @RequirePermissions('purchases.view')
  async findGrnById(@Param('id') id: string) {
    return this.grnService.findById(id);
  }

  @Post('grn')
  @RequirePermissions('purchases.create')
  async createGrn(
    @Body() dto: CreateGoodsReceiveNoteDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.grnService.create(dto, user?.userId);
  }

  @Put('grn/:id')
  @RequirePermissions('purchases.edit')
  async updateGrn(
    @Param('id') id: string,
    @Body() dto: UpdateGoodsReceiveNoteDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.grnService.update(id, dto, user?.userId);
  }

  @Post('grn/:id/post')
  @RequirePermissions('purchases.post_grn')
  async postGrn(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.grnService.postGrn(id, user?.userId);
  }

  @Delete('grn/:id')
  @RequirePermissions('purchases.cancel')
  async deleteDraftGrn(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.grnService.deleteDraft(id, user?.userId);
  }
}
