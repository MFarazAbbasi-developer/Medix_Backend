import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { StockAdjustmentReason } from '@prisma/client';

export class CreateAdjustmentItemDto {
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsInt()
  @IsNotEmpty()
  varianceQuantity!: number; // countedQuantity - currentQuantity: positive (+) for increase, negative (-) for decrease

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateStockAdjustmentDto {
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @IsEnum(StockAdjustmentReason)
  @IsNotEmpty()
  reason!: StockAdjustmentReason;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'Stock adjustment must include at least one item' })
  @ValidateNested({ each: true })
  @Type(() => CreateAdjustmentItemDto)
  items!: CreateAdjustmentItemDto[];
}
