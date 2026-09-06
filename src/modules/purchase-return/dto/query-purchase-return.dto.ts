import {
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PurchaseReturnStatus, PurchaseReturnReason } from '@prisma/client';

export class QueryPurchaseReturnDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  grnId?: string;

  @IsOptional()
  @IsEnum(PurchaseReturnStatus)
  status?: PurchaseReturnStatus;

  @IsOptional()
  @IsEnum(PurchaseReturnReason)
  reason?: PurchaseReturnReason;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
