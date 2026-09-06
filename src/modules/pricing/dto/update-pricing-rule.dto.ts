import {
  IsOptional,
  IsNumber,
  IsBoolean,
  IsDateString,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePricingRuleDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  customPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  discountPercentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  minQuantity?: number;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
