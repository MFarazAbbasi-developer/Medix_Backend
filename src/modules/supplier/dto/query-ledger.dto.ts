import { IsString, IsOptional, IsEnum, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SupplierLedgerEntryType } from '@prisma/client';

export class QuerySupplierLedgerDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(SupplierLedgerEntryType)
  @IsOptional()
  entryType?: SupplierLedgerEntryType;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  limit?: number = 100;
}
