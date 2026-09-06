import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateGoodsReceiveNoteItemDto } from './create-grn.dto';

export class UpdateGoodsReceiveNoteDto {
  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

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
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CreateGoodsReceiveNoteItemDto)
  items?: CreateGoodsReceiveNoteItemDto[];
}
