import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { UpdateNumberingSeriesDto } from './dto/update-numbering-series.dto';
import { GenerateNumberDto } from './dto/generate-number.dto';
import {
  JwtAuthGuard,
  PermissionsGuard,
  RequirePermissions,
  CurrentUser,
  CurrentUserPayload,
} from '../auth';

@Controller('numbering-series')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NumberingController {
  constructor(private readonly numberingService: NumberingService) {}

  @Get()
  @RequirePermissions('settings.view')
  async getSeriesList(@Query('branchId') branchId?: string) {
    return this.numberingService.getSeriesList(branchId);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  async updateSeries(
    @Param('id') id: string,
    @Body() dto: UpdateNumberingSeriesDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.numberingService.updateSeries(id, dto, user?.userId);
  }

  @Post('preview')
  @RequirePermissions('settings.view')
  async previewNextNumber(@Body() dto: GenerateNumberDto) {
    return this.numberingService.previewNextNumber(
      dto.documentType,
      dto.branchId,
    );
  }
}
