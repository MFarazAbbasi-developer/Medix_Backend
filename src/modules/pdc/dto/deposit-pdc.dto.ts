import { IsString, IsNotEmpty, IsOptional, MaxLength, IsDateString } from 'class-validator';

export class DepositPdcDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  depositBankName: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  depositReference?: string;

  @IsOptional()
  @IsDateString()
  depositedAt?: string;
}
