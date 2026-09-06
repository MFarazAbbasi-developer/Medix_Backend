import { Module } from '@nestjs/common';
import { ExpiryService } from './expiry.service';
import { ExpiryController } from './expiry.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NumberingModule } from '../numbering/numbering.module';

@Module({
  imports: [PrismaModule, AuditModule, NumberingModule],
  controllers: [ExpiryController],
  providers: [ExpiryService],
  exports: [ExpiryService],
})
export class ExpiryModule {}
