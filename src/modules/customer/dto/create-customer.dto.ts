import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsNumber,
  IsBoolean,
  IsEnum,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CustomerType } from '@prisma/client';

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(CustomerType)
  @IsOptional()
  customerType?: CustomerType;

  @IsString()
  @IsOptional()
  contactPerson?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  ntn?: string;

  @IsString()
  @IsOptional()
  strn?: string;

  @IsString()
  @IsOptional()
  drugSaleLicenseNo?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  creditDays?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  creditLimit?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  defaultDiscountPercentage?: number;

  @IsBoolean()
  @IsOptional()
  isTaxExempt?: boolean;

  @IsString()
  @IsOptional()
  defaultSalesmanId?: string;

  @IsString()
  @IsOptional()
  routeId?: string;

  @IsNumber()
  @IsOptional()
  @Type(() => Number)
  openingBalance?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
