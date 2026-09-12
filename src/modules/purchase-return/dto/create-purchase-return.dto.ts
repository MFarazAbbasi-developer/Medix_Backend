import {
  IsString,
  IsNotEmpty,
  IsInt,
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
  @IsOptional()
  @IsString()
  grnItemId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

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
  @IsOptional()
  @IsString()
  grnId?: string;

  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  rgaNumber?: string;

  @IsOptional()
  @IsDateString()
  rgaDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  vendorCreditNoteNumber?: string;

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
