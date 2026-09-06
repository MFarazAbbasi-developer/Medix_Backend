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

export class ReceiveStockTransferItemDto {
  @IsUUID()
  @IsNotEmpty()
  itemId: string;

  @IsInt()
  @Min(1)
  receivedQuantity: number;
}

export class ReceiveStockTransferDto {
  @IsArray()
  @IsNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ReceiveStockTransferItemDto)
  items: ReceiveStockTransferItemDto[];

  @IsString()
  @IsOptional()
  notes?: string;
}
