import { Module } from '@nestjs/common';
import { TillSessionController } from './till-session.controller';
import { TillSessionService } from './till-session.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { NumberingModule } from '../numbering/numbering.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, NumberingModule, AuditModule],
  controllers: [TillSessionController],
  providers: [TillSessionService],
  exports: [TillSessionService],
})
export class TillSessionModule {}
