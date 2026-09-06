import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsNumber,
  IsBoolean,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchemeType, CustomerType } from '@prisma/client';

export class CreateSchemeDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(SchemeType)
  schemeType: SchemeType;

  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minQuantity?: number = 1;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  bonusQuantity?: number = 0;

  @IsOptional()
  @IsString()
  bonusProductId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  discountPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  overridePrice?: number;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(CustomerType)
  customerType?: CustomerType;

  @IsDateString()
  startDate: string;

  @IsDateString()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
