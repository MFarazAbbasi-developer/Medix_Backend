import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class CancelPdcDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  cancellationReason: string;
}
