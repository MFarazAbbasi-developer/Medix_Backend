import {
  Controller,
  Get,
  Put,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { ReorderSuggestionsService } from './reorder-suggestions.service';
import {
  QuerySuggestionsDto,
  UpsertReplenishmentConfigDto,
  CreateDraftPosFromSuggestionsDto,
} from './dto/reorder-suggestions.dto';

@Controller('api/v1/purchasing/suggestions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReorderSuggestionsController {
  constructor(
    private readonly suggestionsService: ReorderSuggestionsService,
  ) {}

  @Get()
  @RequirePermissions('purchases.suggestions_view')
  async getSuggestions(@Query() query: QuerySuggestionsDto, @Req() req: any) {
    const contextualBranchId = req.user?.branchId || query.branchId;
    return this.suggestionsService.getSuggestions(query, contextualBranchId);
  }

  @Get('summary')
  @RequirePermissions('purchases.suggestions_view')
  async getSummary(@Query('branchId') branchId: string, @Req() req: any) {
    const contextualBranchId = branchId || req.user?.branchId;
    return this.suggestionsService.getSuggestionSummary(contextualBranchId);
  }

  @Put('config/:productId')
  @RequirePermissions('purchases.suggestions_configure')
  async upsertConfig(
    @Param('productId') productId: string,
    @Body() dto: UpsertReplenishmentConfigDto,
    @Query('branchId') branchId: string,
    @Req() req: any,
  ) {
    const contextualBranchId = branchId || req.user?.branchId;
    return this.suggestionsService.upsertReplenishmentConfig(
      productId,
      dto,
      contextualBranchId,
      req.user?.userId,
    );
  }

  @Post('create-po-draft')
  @RequirePermissions('purchases.create')
  async createDraftPos(
    @Body() dto: CreateDraftPosFromSuggestionsDto,
    @Req() req: any,
  ) {
    return this.suggestionsService.createDraftPurchaseOrders(
      dto,
      req.user?.userId,
    );
  }
}
