import { Module } from '@nestjs/common';
import { DeliveryOrdersController } from './delivery-orders.controller';
import { DeliveryOrdersService } from './delivery-orders.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [PrismaModule, AuditModule, NumberingModule],
  controllers: [DeliveryOrdersController],
  providers: [DeliveryOrdersService],
  exports: [DeliveryOrdersService],
})
export class DeliveryOrdersModule {}
