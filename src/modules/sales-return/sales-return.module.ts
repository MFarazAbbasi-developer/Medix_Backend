import { Module } from '@nestjs/common';
import { SalesReturnService } from './sales-return.service';
import { SalesReturnController } from './sales-return.controller';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [NumberingModule, AuditModule],
  controllers: [SalesReturnController],
  providers: [SalesReturnService],
  exports: [SalesReturnService],
})
export class SalesReturnModule {}
