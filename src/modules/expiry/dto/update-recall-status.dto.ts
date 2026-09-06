import { IsNotEmpty, IsEnum, IsOptional, IsString } from 'class-validator';
import { RecallStatus } from '@prisma/client';

export class UpdateRecallStatusDto {
  @IsNotEmpty()
  @IsEnum(RecallStatus)
  status: RecallStatus;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  cancellationReason?: string;
}
