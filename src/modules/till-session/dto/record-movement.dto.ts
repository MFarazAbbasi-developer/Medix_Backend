import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TillMovementType } from '@prisma/client';

export class RecordTillMovementDto {
  @IsEnum(TillMovementType, {
    message: 'Movement type must be CASH_IN or CASH_OUT',
  })
  movementType: TillMovementType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Movement amount must be greater than 0' })
  @Type(() => Number)
  amount: number;

  @IsString()
  @IsNotEmpty({ message: 'Reason for cash movement is required' })
  @MaxLength(255)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referenceNo?: string;
}
