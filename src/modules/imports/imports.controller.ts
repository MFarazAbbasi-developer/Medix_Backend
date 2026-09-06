import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseInterceptors,
  UploadedFile,
  UseGuards,
  Res,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { type Response } from 'express';
import { ImportsService } from './imports.service';
import { UploadImportDto } from './dto/upload-import.dto';
import { QueryImportDto } from './dto/query-import.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ImportType } from '@prisma/client';

@Controller('imports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ImportsController {
  constructor(private readonly importsService: ImportsService) {}

  /**
   * Uploads and parses an import file, producing structured validation preview and durable job record.
   */
  @Post('upload')
  @RequirePermissions('imports.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 25 * 1024 * 1024, // 25MB limit
      },
    }),
  )
  async uploadFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadImportDto,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.importsService.uploadFile(file, dto, userId);
  }

  /**
   * Retrieves paginated history of past imports.
   */
  @Get()
  @RequirePermissions('imports.view')
  async findAll(@Query() query: QueryImportDto) {
    return this.importsService.findAll(query);
  }

  /**
   * Downloads a starter template file for a given import type.
   */
  @Get('templates/:type')
  @RequirePermissions('imports.view')
  async getTemplate(
    @Param('type') type: ImportType,
    @Res() res: Response,
  ) {
    const { buffer, filename } = this.importsService.getTemplate(type);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * Retrieves full details for a specific import job.
   */
  @Get(':id')
  @RequirePermissions('imports.view')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.findOne(id);
  }

  /**
   * Retrieves structured validation preview with row samples and detected issues.
   */
  @Get(':id/preview')
  @RequirePermissions('imports.view')
  async getPreview(@Param('id', ParseUUIDPipe) id: string) {
    return this.importsService.getPreview(id);
  }

  /**
   * Exports validation errors as a downloadable CSV report.
   */
  @Get(':id/errors/csv')
  @RequirePermissions('imports.view')
  async exportErrorsCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.importsService.exportErrorsCsv(id);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  /**
   * Confirms and executes an import transactionally with row-level locks.
   */
  @Post(':id/confirm')
  @RequirePermissions('imports.manage')
  async confirmImport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.importsService.confirmImport(id, userId);
  }

  /**
   * Cancels an import job.
   */
  @Post(':id/cancel')
  @RequirePermissions('imports.manage')
  async cancelImport(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId?: string,
  ) {
    return this.importsService.cancelImport(id, userId);
  }
}
