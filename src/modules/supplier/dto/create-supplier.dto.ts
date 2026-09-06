import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEmail,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

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
  drugLicenseNo?: string;

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
  @Type(() => Number)
  openingBalance?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
