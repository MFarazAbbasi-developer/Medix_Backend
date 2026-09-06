import { IsOptional, IsString, IsNumber, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ExpiryFilterStatus {
  ALL = 'ALL',
  EXPIRED = 'EXPIRED',
  EXPIRING_SOON = 'EXPIRING_SOON',
  ALL_AFFECTED = 'ALL_AFFECTED', // Expired or Expiring Soon
}

export class QueryExpiryDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  manufacturerId?: string;

  @IsOptional()
  @IsString()
  batchNumber?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ExpiryFilterStatus)
  status?: ExpiryFilterStatus = ExpiryFilterStatus.ALL_AFFECTED;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  thresholdDays?: number = 90; // Default 90 days window

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string = 'expiryDate';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'asc';
}

export class QueryExpiryMetricsDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  thresholds?: string; // Comma-separated e.g. "30,60,90,180"
}
