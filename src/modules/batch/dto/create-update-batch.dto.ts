import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BatchStatus } from '@prisma/client';

export class CreateBatchDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  batchNumber: string;

  @IsOptional()
  @IsDateString()
  mfgDate?: string;

  @IsNotEmpty()
  @IsDateString()
  expiryDate: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tradePrice: number;

  @IsNotEmpty()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  retailPrice: number;

  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus = BatchStatus.ACTIVE;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}

export class UpdateBatchDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  batchNumber?: string;

  @IsOptional()
  @IsDateString()
  mfgDate?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  purchaseCost?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  tradePrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  retailPrice?: number;

  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}

export class QueryBatchDto {
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsEnum(BatchStatus)
  status?: BatchStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @Min(1)
  limit?: number = 50;
}
