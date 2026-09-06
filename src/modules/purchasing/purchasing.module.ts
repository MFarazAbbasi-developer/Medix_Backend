import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { GrnService } from './grn.service';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [AuditModule, NumberingModule],
  controllers: [PurchasingController],
  providers: [PurchaseOrderService, GrnService],
  exports: [PurchaseOrderService, GrnService],
})
export class PurchasingModule {}
