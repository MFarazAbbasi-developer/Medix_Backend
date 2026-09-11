import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SalesmenService } from './salesmen.service';
import {
  CreateSalesmanDto,
  UpdateSalesmanDto,
  QuerySalesmanDto,
} from './dto/salesman.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
} from '../auth';

@Controller('sales-operations/salesmen')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesmenController {
  constructor(private readonly salesmenService: SalesmenService) {}

  @Get()
  @RequirePermissions('sales.salesmen.view')
  async getSalesmen(@Query() query: QuerySalesmanDto, @Request() req: any) {
    const orgId = req.user?.organizationId;
    return this.salesmenService.getSalesmen(query, orgId);
  }

  @Get(':id')
  @RequirePermissions('sales.salesmen.view')
  async getSalesmanById(@Param('id') id: string, @Request() req: any) {
    const orgId = req.user?.organizationId;
    return this.salesmenService.getSalesmanById(id, orgId);
  }

  @Post()
  @RequirePermissions('sales.salesmen.manage')
  async createSalesman(
    @Body() dto: CreateSalesmanDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    return this.salesmenService.createSalesman(dto, userId, orgId);
  }

  @Put(':id')
  @RequirePermissions('sales.salesmen.manage')
  async updateSalesman(
    @Param('id') id: string,
    @Body() dto: UpdateSalesmanDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    return this.salesmenService.updateSalesman(id, dto, userId, orgId);
  }

  @Delete(':id')
  @RequirePermissions('sales.salesmen.manage')
  async deleteSalesman(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    return this.salesmenService.deleteSalesman(id, userId, orgId);
  }
}
