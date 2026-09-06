import { Module } from '@nestjs/common';
import { MasterDataService } from './master-data.service';
import { MasterDataController } from './master-data.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [MasterDataController],
  providers: [MasterDataService],
  exports: [MasterDataService],
})
export class MasterDataModule {}
