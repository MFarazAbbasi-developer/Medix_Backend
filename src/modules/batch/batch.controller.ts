import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BatchService } from './batch.service';
import {
  CreateBatchDto,
  UpdateBatchDto,
  QueryBatchDto,
} from './dto/create-update-batch.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  @Get('products/:productId/batches')
  @RequirePermissions('batches.view')
  async findByProduct(@Param('productId') productId: string) {
    return this.batchService.findByProduct(productId);
  }

  @Post('products/:productId/batches')
  @RequirePermissions('batches.create')
  async create(
    @Param('productId') productId: string,
    @Body() dto: CreateBatchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.batchService.create(productId, dto, user?.userId);
  }

  @Get('batches')
  @RequirePermissions('batches.view')
  async findAll(@Query() query: QueryBatchDto) {
    return this.batchService.findAll(query);
  }

  @Patch('batches/:id')
  @RequirePermissions('batches.edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBatchDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.batchService.update(id, dto, user?.userId);
  }
}
