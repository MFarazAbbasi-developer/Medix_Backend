import { Controller, Post, Body, UseGuards, Res } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';
import { DataExportService } from '../services/data-export.service';
import { ExportDatasetDto } from '../dto/data-export.dto';

@Controller('admin/export')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DataExportController {
  constructor(private readonly dataExportService: DataExportService) {}

  @Post('csv')
  @RequirePermissions('data.export')
  async exportCsv(@Body() dto: ExportDatasetDto, @Res() res: Response) {
    const result = await this.dataExportService.exportDataset(dto);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"`,
    );
    res.setHeader('X-Row-Count', result.rowCount.toString());
    return res.send(result.data);
  }
}
