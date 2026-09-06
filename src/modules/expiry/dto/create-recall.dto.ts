import {
  IsNotEmpty,
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { RecallSeverity } from '@prisma/client';

export class CreateRecallDto {
  @IsNotEmpty()
  @IsString()
  productId: string;

  @IsNotEmpty()
  @IsString()
  batchId: string;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsOptional()
  @IsEnum(RecallSeverity)
  severity?: RecallSeverity = RecallSeverity.HIGH;

  @IsOptional()
  @IsDateString()
  recallDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  autoQuarantine?: boolean = false;

  @IsOptional()
  @IsString()
  quarantineWarehouseId?: string;
}
