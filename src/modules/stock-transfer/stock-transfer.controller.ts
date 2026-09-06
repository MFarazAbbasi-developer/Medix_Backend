import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { StockTransferService } from './stock-transfer.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { UpdateStockTransferDto } from './dto/update-stock-transfer.dto';
import { DispatchStockTransferDto } from './dto/dispatch-stock-transfer.dto';
import { ReceiveStockTransferDto } from './dto/receive-stock-transfer.dto';
import { CancelStockTransferDto } from './dto/cancel-stock-transfer.dto';
import { QueryStockTransferDto } from './dto/query-stock-transfer.dto';
import { PreviewTransferFefoDto } from './dto/preview-transfer-fefo.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';

@Controller('transfers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class StockTransferController {
  constructor(private readonly transferService: StockTransferService) {}

  @Get('metrics')
  @RequirePermissions('transfers.view')
  async getMetrics(@Query('branchId') branchId?: string) {
    return this.transferService.getMetrics(branchId);
  }

  @Post('preview-fefo')
  @RequirePermissions('transfers.view')
  async previewFefo(@Body() dto: PreviewTransferFefoDto) {
    return this.transferService.previewFefo(dto);
  }

  @Get()
  @RequirePermissions('transfers.view')
  async getTransfers(@Query() query: QueryStockTransferDto) {
    return this.transferService.getTransfers(query);
  }

  @Get(':id')
  @RequirePermissions('transfers.view')
  async getTransferById(@Param('id') id: string) {
    return this.transferService.getTransferById(id);
  }

  @Post()
  @RequirePermissions('transfers.manage')
  async createDraft(@Body() dto: CreateStockTransferDto, @Req() req: any) {
    return this.transferService.createDraft(dto, req.user?.id);
  }

  @Put(':id')
  @RequirePermissions('transfers.manage')
  async updateDraft(
    @Param('id') id: string,
    @Body() dto: UpdateStockTransferDto,
    @Req() req: any,
  ) {
    return this.transferService.updateDraft(id, dto, req.user?.id);
  }

  @Post(':id/dispatch')
  @RequirePermissions('transfers.dispatch')
  async dispatchTransfer(
    @Param('id') id: string,
    @Body() dto: DispatchStockTransferDto,
    @Req() req: any,
  ) {
    return this.transferService.dispatchTransfer(id, dto, req.user?.id);
  }

  @Post(':id/receive')
  @RequirePermissions('transfers.receive')
  async receiveTransfer(
    @Param('id') id: string,
    @Body() dto: ReceiveStockTransferDto,
    @Req() req: any,
  ) {
    return this.transferService.receiveTransfer(id, dto, req.user?.id);
  }

  @Post(':id/cancel')
  @RequirePermissions('transfers.cancel')
  async cancelTransfer(
    @Param('id') id: string,
    @Body() dto: CancelStockTransferDto,
    @Req() req: any,
  ) {
    return this.transferService.cancelTransfer(id, dto, req.user?.id);
  }
}
