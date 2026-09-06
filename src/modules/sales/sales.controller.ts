import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SalesService } from './sales.service';
import { CreateSalesInvoiceDto } from './dto/create-sales-invoice.dto';
import { FefoPreviewDto } from './dto/fefo-preview.dto';
import { QuerySalesInvoiceDto } from './dto/query-sales-invoice.dto';
import { CancelSalesInvoiceDto } from './dto/cancel-sales-invoice.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('sales')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post('fefo-preview')
  @RequirePermissions('sales.view')
  async previewFefo(@Body() dto: FefoPreviewDto) {
    return this.salesService.previewFefo(dto);
  }

  @Get('invoices')
  @RequirePermissions('sales.view')
  async getInvoices(@Query() query: QuerySalesInvoiceDto) {
    return this.salesService.getInvoices(query);
  }

  @Get('invoices/:id')
  @RequirePermissions('sales.view')
  async getInvoiceById(@Param('id') id: string) {
    return this.salesService.getInvoiceById(id);
  }

  @Post('invoices')
  @RequirePermissions('sales.create')
  async createInvoice(
    @Body() dto: CreateSalesInvoiceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.salesService.createSalesInvoice(
      dto,
      user?.userId,
      user?.permissions,
      user?.roles,
    );
  }

  @Post('invoices/:id/post')
  @RequirePermissions('sales.create')
  async postDraftInvoice(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.salesService.postDraftInvoice(
      id,
      user?.userId,
      user?.permissions,
      user?.roles,
    );
  }

  @Post('invoices/:id/cancel')
  @RequirePermissions('sales.cancel')
  async cancelInvoice(
    @Param('id') id: string,
    @Body() dto: CancelSalesInvoiceDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.salesService.cancelSalesInvoice(id, user?.userId, dto);
  }

  @Get('metrics')
  @RequirePermissions('sales.view')
  async getSalesMetrics(@Query('branchId') branchId?: string) {
    return this.salesService.getSalesMetrics(branchId);
  }
}
