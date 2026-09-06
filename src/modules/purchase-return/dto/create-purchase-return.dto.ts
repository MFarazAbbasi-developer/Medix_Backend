import {
  IsString,
  IsNotEmpty,
  IsInt,
  IsPositive,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReturnedStockCondition, PurchaseReturnReason } from '@prisma/client';

export class CreatePurchaseReturnItemDto {
  @IsString()
  @IsNotEmpty()
  grnItemId: string;

  @IsInt()
  @Min(0)
  returnedQuantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusReturnedQuantity?: number = 0;

  @IsEnum(ReturnedStockCondition)
  stockCondition: ReturnedStockCondition;

  @IsString()
  @IsNotEmpty()
  sourceWarehouseId: string;
}

export class CreatePurchaseReturnDto {
  @IsString()
  @IsNotEmpty()
  grnId: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @IsEnum(PurchaseReturnReason)
  reason: PurchaseReturnReason;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseReturnItemDto)
  items: CreatePurchaseReturnItemDto[];
}
