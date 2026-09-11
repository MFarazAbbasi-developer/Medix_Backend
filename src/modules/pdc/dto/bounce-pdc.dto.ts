import { IsString, IsNotEmpty, IsOptional, MaxLength, IsDateString } from 'class-validator';

export class BouncePdcDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  bounceReason: string;

  @IsOptional()
  @IsDateString()
  bouncedAt?: string;
}
