import {
  IsString,
  IsOptional,
  IsEmail,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateSupplierDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsString()
  @IsOptional()
  name?: string;

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

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
