import {
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OpenTillSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Opening cash float must be greater than or equal to 0' })
  @Type(() => Number)
  openingCash: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  stationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
