import {
  IsString,
  IsUUID,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateStockTransferItemDto } from './create-stock-transfer.dto';

export class UpdateStockTransferDto {
  @IsUUID()
  @IsOptional()
  sourceWarehouseId?: string;

  @IsUUID()
  @IsOptional()
  destinationWarehouseId?: string;

  @IsDateString()
  @IsOptional()
  transferDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateStockTransferItemDto)
  items?: CreateStockTransferItemDto[];
}
