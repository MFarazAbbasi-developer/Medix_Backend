import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { PricingEngineService } from './pricing-engine.service';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [PricingController],
  providers: [PricingEngineService, PricingService],
  exports: [PricingEngineService, PricingService],
})
export class PricingModule {}
