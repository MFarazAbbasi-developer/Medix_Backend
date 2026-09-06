import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RequirePermissions } from '../../auth/decorators/permissions.decorator';
import { BackupService } from '../services/backup.service';
import { CreateBackupDto, RestoreBackupDto } from '../dto/backup-admin.dto';

@Controller('admin/backup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get()
  @RequirePermissions('backup.view')
  async listBackups() {
    return this.backupService.listBackups();
  }

  @Get('validate/:filename')
  @RequirePermissions('backup.view')
  async validateBackup(@Param('filename') filename: string) {
    return this.backupService.validateBackup(filename);
  }

  @Post('create')
  @RequirePermissions('backup.manage')
  async createBackup(@Body() dto: CreateBackupDto, @Req() req: any) {
    return this.backupService.createBackup(dto, req.user);
  }

  @Post('restore')
  @RequirePermissions('backup.restore')
  async restoreBackup(@Body() dto: RestoreBackupDto, @Req() req: any) {
    return this.backupService.restoreBackup(dto, req.user);
  }
}
