import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PdcService } from './pdc.service';
import { CreatePdcDto } from './dto/create-pdc.dto';
import { DepositPdcDto } from './dto/deposit-pdc.dto';
import { ClearPdcDto } from './dto/clear-pdc.dto';
import { BouncePdcDto } from './dto/bounce-pdc.dto';
import { CancelPdcDto } from './dto/cancel-pdc.dto';
import { QueryPdcDto } from './dto/query-pdc.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('pdc')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PdcController {
  constructor(private readonly pdcService: PdcService) {}

  @Get()
  @RequirePermissions('payments.pdc.view')
  async getPdcs(@Query() query: QueryPdcDto) {
    return this.pdcService.getPdcs(query);
  }

  @Get(':id')
  @RequirePermissions('payments.pdc.view')
  async getPdcById(@Param('id') id: string) {
    return this.pdcService.getPdcById(id);
  }

  @Get(':id/receipt')
  @RequirePermissions('payments.pdc.view')
  async getPrintablePdcReceipt(@Param('id') id: string) {
    return this.pdcService.getPrintablePdcReceipt(id);
  }

  @Post()
  @RequirePermissions('payments.pdc.create')
  async createPdc(
    @Body() dto: CreatePdcDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pdcService.createPdc(dto, undefined, user?.userId);
  }

  @Post(':id/deposit')
  @RequirePermissions('payments.pdc.deposit')
  async depositPdc(
    @Param('id') id: string,
    @Body() dto: DepositPdcDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pdcService.depositPdc(id, dto, user?.userId);
  }

  @Post(':id/clear')
  @RequirePermissions('payments.pdc.clear')
  async clearPdc(
    @Param('id') id: string,
    @Body() dto: ClearPdcDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pdcService.clearPdc(id, dto, undefined, user?.userId);
  }

  @Post(':id/bounce')
  @RequirePermissions('payments.pdc.bounce')
  async bouncePdc(
    @Param('id') id: string,
    @Body() dto: BouncePdcDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pdcService.bouncePdc(id, dto, user?.userId);
  }

  @Post(':id/cancel')
  @RequirePermissions('payments.pdc.cancel')
  async cancelPdc(
    @Param('id') id: string,
    @Body() dto: CancelPdcDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pdcService.cancelPdc(id, dto, user?.userId);
  }
}
