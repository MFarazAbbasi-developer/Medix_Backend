import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsArray,
  ValidateNested,
  IsNumber,
  IsDateString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateGoodsReceiveNoteItemDto {
  @IsString()
  @IsOptional()
  poItemId?: string;

  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsString()
  @IsOptional()
  batchId?: string;

  @IsString()
  @IsNotEmpty()
  batchNumber: string;

  @IsDateString()
  @IsOptional()
  mfgDate?: string;

  @IsDateString()
  @IsNotEmpty()
  expiryDate: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  receivedQuantity: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Type(() => Number)
  bonusQuantity?: number = 0;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  unitCost: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  tradePrice: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  retailPrice: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  discountPercentage?: number = 0;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  taxPercentage?: number = 0;

  @IsString()
  @IsOptional()
  remarks?: string;
}

export class CreateGoodsReceiveNoteDto {
  @IsString()
  @IsNotEmpty()
  branchId: string;

  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  @IsString()
  @IsNotEmpty()
  supplierId: string;

  @IsString()
  @IsOptional()
  purchaseOrderId?: string;

  @IsString()
  @IsOptional()
  supplierInvoiceNumber?: string;

  @IsDateString()
  @IsOptional()
  supplierInvoiceDate?: string;

  @IsDateString()
  @IsOptional()
  receivedDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiveNoteItemDto)
  items: CreateGoodsReceiveNoteItemDto[];
}
