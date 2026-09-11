import { Module } from '@nestjs/common';
import { PdcService } from './pdc.service';
import { PdcController } from './pdc.controller';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [NumberingModule, AuditModule],
  controllers: [PdcController],
  providers: [PdcService],
  exports: [PdcService],
})
export class PdcModule {}
