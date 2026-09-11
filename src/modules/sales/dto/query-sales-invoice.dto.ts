import { IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SalesInvoiceStatus, PaymentMethod } from '@prisma/client';

export class QuerySalesInvoiceDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsString()
  @IsOptional()
  customerId?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsString()
  @IsOptional()
  salesmanId?: string;

  @IsString()
  @IsOptional()
  routeId?: string;

  @IsString()
  @IsOptional()
  deliveryAddressId?: string;

  @IsEnum(SalesInvoiceStatus)
  @IsOptional()
  status?: SalesInvoiceStatus;

  @IsEnum(PaymentMethod)
  @IsOptional()
  paymentMethod?: PaymentMethod;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsInt()
  @Min(1)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 50;
}
