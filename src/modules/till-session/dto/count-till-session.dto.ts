import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DenominationCountItemDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Type(() => Number)
  denominationValue: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  noteCount: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  totalAmount: number;
}

export class CountTillSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Actual physical cash count must be greater than or equal to 0' })
  @Type(() => Number)
  actualCash: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DenominationCountItemDto)
  denominations?: DenominationCountItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  varianceReason?: string;
}
