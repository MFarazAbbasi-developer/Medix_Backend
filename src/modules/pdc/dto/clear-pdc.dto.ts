import { IsOptional, IsString, MaxLength, IsDateString } from 'class-validator';

export class ClearPdcDto {
  @IsOptional()
  @IsDateString()
  clearedAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
