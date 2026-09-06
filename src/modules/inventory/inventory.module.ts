import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { FefoService } from './fefo.service';
import { InventoryController } from './inventory.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';
import { SettingsModule } from '../settings/settings.module';

@Module({
  imports: [PrismaModule, AuditModule, NumberingModule, SettingsModule],
  controllers: [InventoryController],
  providers: [InventoryService, FefoService],
  exports: [InventoryService, FefoService],
})
export class InventoryModule {}
