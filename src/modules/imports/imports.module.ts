import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ImportParserService } from './services/import-parser.service';
import { ImportValidatorService } from './services/import-validator.service';
import { ImportExecutorService } from './services/import-executor.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    AuditModule,
    MulterModule.register({
      storage: memoryStorage(),
    }),
  ],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    ImportParserService,
    ImportValidatorService,
    ImportExecutorService,
  ],
  exports: [ImportsService],
})
export class ImportsModule {}
