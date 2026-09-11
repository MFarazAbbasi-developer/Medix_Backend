import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class FulfillmentItemDto {
  @IsNotEmpty()
  @IsUUID()
  deliveryOrderItemId: string;

  @IsInt()
  @Min(0)
  billedQuantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  bonusQuantity?: number;
}

export class RecordFulfillmentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FulfillmentItemDto)
  items: FulfillmentItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;
}
