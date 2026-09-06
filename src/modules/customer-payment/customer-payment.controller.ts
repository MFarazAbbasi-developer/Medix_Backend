import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { CustomerPaymentService } from './customer-payment.service';
import { CreateCustomerPaymentDto } from './dto/create-customer-payment.dto';
import { QueryCustomerPaymentDto } from './dto/query-customer-payment.dto';
import { CancelCustomerPaymentDto } from './dto/cancel-customer-payment.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('customer-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomerPaymentController {
  constructor(private readonly paymentService: CustomerPaymentService) {}

  @Get('unpaid-invoices/:customerId')
  @RequirePermissions('payments.view')
  async getUnpaidInvoices(@Param('customerId') customerId: string) {
    return this.paymentService.getUnpaidInvoices(customerId);
  }

  @Get()
  @RequirePermissions('payments.view')
  async findAll(@Query() query: QueryCustomerPaymentDto) {
    return this.paymentService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('payments.view')
  async findOne(@Param('id') id: string) {
    return this.paymentService.findOne(id);
  }

  @Post()
  @RequirePermissions('payments.create')
  async create(
    @Body() dto: CreateCustomerPaymentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.paymentService.createPayment(dto, user?.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('payments.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelCustomerPaymentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.paymentService.cancelPayment(id, dto, user?.userId);
  }
}
