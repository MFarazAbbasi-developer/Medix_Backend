import { IsOptional, IsString, IsDateString, IsNumber, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum ReportExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

export class QueryReportDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  manufacturerId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ReportExportFormat)
  format?: ReportExportFormat = ReportExportFormat.JSON;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class QueryCustomerStatementDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(ReportExportFormat)
  format?: ReportExportFormat = ReportExportFormat.JSON;
}

export class QuerySupplierStatementDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(ReportExportFormat)
  format?: ReportExportFormat = ReportExportFormat.JSON;
}
