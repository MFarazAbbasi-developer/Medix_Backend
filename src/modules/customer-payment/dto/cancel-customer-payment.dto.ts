import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class CancelCustomerPaymentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Cancellation reason must be at least 3 characters long' })
  @MaxLength(500, { message: 'Cancellation reason must not exceed 500 characters' })
  cancellationReason: string;
}
