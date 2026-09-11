import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { DeliveryOrdersService } from './delivery-orders.service';
import { CreateDeliveryOrderDto } from './dto/create-delivery-order.dto';
import { RecordFulfillmentDto } from './dto/record-fulfillment.dto';
import { CancelDeliveryOrderDto } from './dto/cancel-delivery-order.dto';
import { QueryDeliveryOrdersDto } from './dto/query-delivery-orders.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('delivery-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DeliveryOrdersController {
  constructor(
    private readonly deliveryOrdersService: DeliveryOrdersService,
  ) {}

  @Get()
  @RequirePermissions('delivery_orders.view')
  async getDeliveryOrders(@Query() query: QueryDeliveryOrdersDto) {
    return this.deliveryOrdersService.getDeliveryOrders(query);
  }

  @Get('eligible-invoices')
  @RequirePermissions('delivery_orders.view')
  async getEligibleInvoices(
    @Query('search') search?: string,
    @Query('customerId') customerId?: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.deliveryOrdersService.getEligibleInvoices(
      search,
      customerId,
      branchId,
    );
  }

  @Get(':id')
  @RequirePermissions('delivery_orders.view')
  async getDeliveryOrderById(@Param('id') id: string) {
    return this.deliveryOrdersService.getDeliveryOrderById(id);
  }

  @Post()
  @RequirePermissions('delivery_orders.create')
  async createDeliveryOrder(
    @Body() dto: CreateDeliveryOrderDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.deliveryOrdersService.createDeliveryOrder(dto, user?.userId);
  }

  @Post(':id/fulfill')
  @RequirePermissions('delivery_orders.fulfill')
  async recordFulfillment(
    @Param('id') id: string,
    @Body() dto: RecordFulfillmentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.deliveryOrdersService.recordFulfillment(id, dto, user?.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('delivery_orders.cancel')
  async cancelDeliveryOrder(
    @Param('id') id: string,
    @Body() dto: CancelDeliveryOrderDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.deliveryOrdersService.cancelDeliveryOrder(
      id,
      dto,
      user?.userId,
    );
  }
}
