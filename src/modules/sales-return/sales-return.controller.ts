import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SalesReturnService } from './sales-return.service';
import { CreateSalesReturnDto } from './dto/create-sales-return.dto';
import { QuerySalesReturnDto } from './dto/query-sales-return.dto';
import { CancelSalesReturnDto } from './dto/cancel-sales-return.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('sales-returns')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesReturnController {
  constructor(private readonly salesReturnService: SalesReturnService) {}

  @Get('returnable-invoice/:invoiceId')
  @RequirePermissions('returns.view')
  async getReturnableInvoice(@Param('invoiceId') invoiceId: string) {
    return this.salesReturnService.getReturnableInvoice(invoiceId);
  }

  @Get()
  @RequirePermissions('returns.view')
  async findAll(@Query() query: QuerySalesReturnDto) {
    return this.salesReturnService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('returns.view')
  async findOne(@Param('id') id: string) {
    return this.salesReturnService.findOne(id);
  }

  @Post()
  @RequirePermissions('returns.create')
  async create(
    @Body() dto: CreateSalesReturnDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.salesReturnService.createSalesReturn(dto, user?.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('returns.cancel')
  async cancel(
    @Param('id') id: string,
    @Body() dto: CancelSalesReturnDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.salesReturnService.cancelSalesReturn(id, dto, user?.userId);
  }
}
