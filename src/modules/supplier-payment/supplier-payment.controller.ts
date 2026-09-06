import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SupplierPaymentService } from './supplier-payment.service';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { QuerySupplierPaymentDto } from './dto/query-supplier-payment.dto';
import { CancelSupplierPaymentDto } from './dto/cancel-supplier-payment.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('supplier-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupplierPaymentController {
  constructor(private readonly paymentService: SupplierPaymentService) {}

  @Get('unpaid-grns/:supplierId')
  @RequirePermissions('payments.view')
  async getUnpaidGrns(@Param('supplierId') supplierId: string) {
    return this.paymentService.getUnpaidGrns(supplierId);
  }

  @Get()
  @RequirePermissions('payments.view')
  async findAll(@Query() query: QuerySupplierPaymentDto) {
    return this.paymentService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('payments.view')
  async findOne(@Param('id') id: string) {
    return this.paymentService.findById(id);
  }

  @Post()
  @RequirePermissions('payments.create')
  async create(
    @Body() dto: CreateSupplierPaymentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.paymentService.createPayment(dto, user?.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('payments.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelSupplierPaymentDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.paymentService.cancelPayment(id, dto, user?.userId);
  }
}
