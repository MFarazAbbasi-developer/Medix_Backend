import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { QuerySupplierLedgerDto } from './dto/query-ledger.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  @RequirePermissions('suppliers.view')
  async findAll(@Query() query: QuerySupplierDto) {
    return this.supplierService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('suppliers.view')
  async findById(@Param('id') id: string) {
    return this.supplierService.findById(id);
  }

  @Post()
  @RequirePermissions('suppliers.create')
  async create(
    @Body() dto: CreateSupplierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.supplierService.create(dto, user?.userId);
  }

  @Put(':id')
  @RequirePermissions('suppliers.edit')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.supplierService.update(id, dto, user?.userId);
  }

  @Get(':id/ledger')
  @RequirePermissions('suppliers.ledger_view')
  async getLedger(
    @Param('id') id: string,
    @Query() query: QuerySupplierLedgerDto,
  ) {
    return this.supplierService.getLedger(id, query);
  }
}
