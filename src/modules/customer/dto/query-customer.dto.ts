import { IsString, IsOptional, IsBoolean, IsEnum, IsInt, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CustomerType, CustomerLedgerEntryType } from '@prisma/client';

export class QueryCustomerDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(CustomerType)
  @IsOptional()
  customerType?: CustomerType;

  @IsString()
  @IsOptional()
  salesmanId?: string;

  @IsString()
  @IsOptional()
  routeId?: string;

  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  isActive?: boolean;

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

export class QueryCustomerLedgerDto {
  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsEnum(CustomerLedgerEntryType)
  @IsOptional()
  entryType?: CustomerLedgerEntryType;

  @IsString()
  @IsOptional()
  branchId?: string;

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
