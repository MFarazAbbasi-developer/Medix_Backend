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
import { SalesRoutesService } from './sales-routes.service';
import {
  CreateSalesRouteDto,
  UpdateSalesRouteDto,
  QuerySalesRouteDto,
} from './dto/sales-route.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
} from '../auth';

@Controller('sales-operations/routes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalesRoutesController {
  constructor(private readonly salesRoutesService: SalesRoutesService) {}

  @Get()
  @RequirePermissions('sales.routes.view')
  async getRoutes(@Query() query: QuerySalesRouteDto, @Request() req: any) {
    const orgId = req.user?.organizationId;
    return this.salesRoutesService.getRoutes(query, orgId);
  }

  @Get(':id')
  @RequirePermissions('sales.routes.view')
  async getRouteById(@Param('id') id: string, @Request() req: any) {
    const orgId = req.user?.organizationId;
    return this.salesRoutesService.getRouteById(id, orgId);
  }

  @Post()
  @RequirePermissions('sales.routes.manage')
  async createRoute(
    @Body() dto: CreateSalesRouteDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    return this.salesRoutesService.createRoute(dto, userId, orgId);
  }

  @Put(':id')
  @RequirePermissions('sales.routes.manage')
  async updateRoute(
    @Param('id') id: string,
    @Body() dto: UpdateSalesRouteDto,
    @Request() req: any,
  ) {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    return this.salesRoutesService.updateRoute(id, dto, userId, orgId);
  }

  @Delete(':id')
  @RequirePermissions('sales.routes.manage')
  async deleteRoute(@Param('id') id: string, @Request() req: any) {
    const userId = req.user?.id;
    const orgId = req.user?.organizationId;
    return this.salesRoutesService.deleteRoute(id, userId, orgId);
  }
}
