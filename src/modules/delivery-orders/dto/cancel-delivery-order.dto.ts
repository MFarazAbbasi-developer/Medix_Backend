import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CancelDeliveryOrderDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(500)
  cancellationReason: string;
}
