import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsOptional,
  IsArray,
  ValidateNested,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateStockTransferItemDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsUUID()
  @IsNotEmpty()
  batchId: string;

  @IsInt()
  @Min(1)
  requestedQuantity: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateStockTransferDto {
  @IsUUID()
  @IsOptional()
  branchId?: string;

  @IsUUID()
  @IsNotEmpty()
  sourceWarehouseId: string;

  @IsUUID()
  @IsNotEmpty()
  destinationWarehouseId: string;

  @IsDateString()
  @IsOptional()
  transferDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferItemDto)
  items: CreateStockTransferItemDto[];
}
