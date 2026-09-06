import { Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { NumberingController } from './numbering.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
