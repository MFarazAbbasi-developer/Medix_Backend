import { Module } from '@nestjs/common';
import { PurchaseReturnService } from './purchase-return.service';
import { PurchaseReturnController } from './purchase-return.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [PrismaModule, AuditModule, NumberingModule],
  controllers: [PurchaseReturnController],
  providers: [PurchaseReturnService],
  exports: [PurchaseReturnService],
})
export class PurchaseReturnModule {}
