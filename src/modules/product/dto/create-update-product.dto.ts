import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  sku: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  name: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(150)
  genericName: string;

  @IsOptional()
  @IsString()
  manufacturerId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  dosageForm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  packSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  genericName?: string;

  @IsOptional()
  @IsString()
  manufacturerId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  dosageForm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  packSize?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  taxPercentage?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
