import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { UsersAdminService } from './services/users-admin.service';
import { RolesAdminService } from './services/roles-admin.service';
import { BackupService } from './services/backup.service';
import { DataExportService } from './services/data-export.service';
import { UsersAdminController } from './controllers/users-admin.controller';
import { RolesAdminController } from './controllers/roles-admin.controller';
import { BackupController } from './controllers/backup.controller';
import { DataExportController } from './controllers/data-export.controller';
import { SystemInfoController } from './controllers/system-info.controller';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [
    UsersAdminController,
    RolesAdminController,
    BackupController,
    DataExportController,
    SystemInfoController,
  ],
  providers: [
    UsersAdminService,
    RolesAdminService,
    BackupService,
    DataExportService,
  ],
  exports: [
    UsersAdminService,
    RolesAdminService,
    BackupService,
    DataExportService,
  ],
})
export class AdminModule {}
