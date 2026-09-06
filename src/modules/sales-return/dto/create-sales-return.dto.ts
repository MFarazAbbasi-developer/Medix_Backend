import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  IsOptional,
  IsArray,
  ValidateNested,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReturnReason, ReturnedStockCondition, ReturnRefundMode } from '@prisma/client';

export class CreateSalesReturnItemDto {
  @IsString()
  @IsNotEmpty()
  salesInvoiceItemId: string;

  @IsNumber()
  @IsPositive()
  @Min(1)
  returnedQuantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  bonusReturnedQuantity?: number = 0;

  @IsEnum(ReturnedStockCondition)
  stockCondition: ReturnedStockCondition;

  @IsString()
  @IsNotEmpty()
  destinationWarehouseId: string;
}

export class CreateSalesReturnDto {
  @IsString()
  @IsNotEmpty()
  salesInvoiceId: string;

  @IsOptional()
  @IsDateString()
  returnDate?: string;

  @IsEnum(ReturnReason)
  reason: ReturnReason;

  @IsEnum(ReturnRefundMode)
  refundMode: ReturnRefundMode;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateSalesReturnItemDto)
  items: CreateSalesReturnItemDto[];
}
