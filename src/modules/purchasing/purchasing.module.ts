import { Module } from '@nestjs/common';
import { PurchasingController } from './purchasing.controller';
import { ReorderSuggestionsController } from './reorder-suggestions.controller';
import { PurchaseOrderService } from './purchase-order.service';
import { GrnService } from './grn.service';
import { ReorderSuggestionsService } from './reorder-suggestions.service';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [AuditModule, NumberingModule],
  controllers: [PurchasingController, ReorderSuggestionsController],
  providers: [PurchaseOrderService, GrnService, ReorderSuggestionsService],
  exports: [PurchaseOrderService, GrnService, ReorderSuggestionsService],
})
export class PurchasingModule {}

