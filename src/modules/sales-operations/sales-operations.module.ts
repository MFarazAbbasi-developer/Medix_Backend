import { Module } from '@nestjs/common';
import { SalesmenController } from './salesmen.controller';
import { SalesmenService } from './salesmen.service';
import { SalesRoutesController } from './sales-routes.controller';
import { SalesRoutesService } from './sales-routes.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [SalesmenController, SalesRoutesController],
  providers: [SalesmenService, SalesRoutesService],
  exports: [SalesmenService, SalesRoutesService],
})
export class SalesOperationsModule {}
