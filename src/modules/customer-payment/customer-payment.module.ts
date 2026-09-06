import { Module } from '@nestjs/common';
import { CustomerPaymentService } from './customer-payment.service';
import { CustomerPaymentController } from './customer-payment.controller';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [NumberingModule, AuditModule],
  controllers: [CustomerPaymentController],
  providers: [CustomerPaymentService],
  exports: [CustomerPaymentService],
})
export class CustomerPaymentModule {}
