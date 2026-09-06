import { IsBoolean, IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class UpdateNumberingSeriesDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  prefix?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  suffix?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  nextNumber?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  padding?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
