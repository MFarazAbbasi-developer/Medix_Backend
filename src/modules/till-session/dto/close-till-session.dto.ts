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
import { DenominationCountItemDto } from './count-till-session.dto';

export class CloseTillSessionDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Actual physical cash must be greater than or equal to 0' })
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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @IsOptional()
  @IsString()
  approvedByUserId?: string;
}
