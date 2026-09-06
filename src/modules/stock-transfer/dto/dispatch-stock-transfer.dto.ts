import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsUUID,
  IsInt,
  Min,
  IsNotEmpty,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DispatchStockTransferItemDto {
  @IsUUID()
  @IsNotEmpty()
  itemId: string;

  @IsInt()
  @Min(1)
  dispatchedQuantity: number;
}

export class DispatchStockTransferDto {
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => DispatchStockTransferItemDto)
  items?: DispatchStockTransferItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}
