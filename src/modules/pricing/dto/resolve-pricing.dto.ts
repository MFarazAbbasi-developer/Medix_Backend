import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ResolvePricingDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  productId: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  quantity: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  manualUnitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  manualDiscountPercentage?: number;
}
