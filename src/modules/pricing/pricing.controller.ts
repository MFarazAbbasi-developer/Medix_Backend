import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { PricingService } from './pricing.service';
import { CreatePricingRuleDto } from './dto/create-pricing-rule.dto';
import { UpdatePricingRuleDto } from './dto/update-pricing-rule.dto';
import { QueryPricingRuleDto } from './dto/query-pricing-rule.dto';
import { CreateSchemeDto } from './dto/create-scheme.dto';
import { UpdateSchemeDto } from './dto/update-scheme.dto';
import { QuerySchemeDto } from './dto/query-scheme.dto';
import { ResolvePricingDto } from './dto/resolve-pricing.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('pricing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  // ==========================================
  // CUSTOMER PRICING RULES
  // ==========================================

  @Get('rules')
  @RequirePermissions('pricing.view')
  async getPricingRules(@Query() query: QueryPricingRuleDto) {
    return this.pricingService.getPricingRules(query);
  }

  @Get('rules/:id')
  @RequirePermissions('pricing.view')
  async getPricingRuleById(@Param('id') id: string) {
    return this.pricingService.getPricingRuleById(id);
  }

  @Post('rules')
  @RequirePermissions('pricing.manage')
  async createPricingRule(
    @Body() dto: CreatePricingRuleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pricingService.createPricingRule(dto, user?.userId);
  }

  @Put('rules/:id')
  @RequirePermissions('pricing.manage')
  async updatePricingRule(
    @Param('id') id: string,
    @Body() dto: UpdatePricingRuleDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pricingService.updatePricingRule(id, dto, user?.userId);
  }

  @Delete('rules/:id')
  @RequirePermissions('pricing.manage')
  async deletePricingRule(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pricingService.deletePricingRule(id, user?.userId);
  }

  // ==========================================
  // PROMOTIONAL SCHEMES
  // ==========================================

  @Get('schemes')
  @RequirePermissions('schemes.view')
  async getSchemes(@Query() query: QuerySchemeDto) {
    return this.pricingService.getSchemes(query);
  }

  @Get('schemes/:id')
  @RequirePermissions('schemes.view')
  async getSchemeById(@Param('id') id: string) {
    return this.pricingService.getSchemeById(id);
  }

  @Post('schemes')
  @RequirePermissions('schemes.manage')
  async createScheme(
    @Body() dto: CreateSchemeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pricingService.createScheme(dto, user?.userId);
  }

  @Put('schemes/:id')
  @RequirePermissions('schemes.manage')
  async updateScheme(
    @Param('id') id: string,
    @Body() dto: UpdateSchemeDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pricingService.updateScheme(id, dto, user?.userId);
  }

  @Delete('schemes/:id')
  @RequirePermissions('schemes.manage')
  async deleteScheme(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.pricingService.deleteScheme(id, user?.userId);
  }

  // ==========================================
  // PRICING SIMULATION & PREVIEW
  // ==========================================

  @Post('preview')
  @RequirePermissions('pricing.view')
  async previewPricing(@Body() dto: ResolvePricingDto) {
    return this.pricingService.previewPricing(dto);
  }
}
