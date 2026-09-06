import { IsString, IsNotEmpty } from 'class-validator';

export class CancelStockTransferDto {
  @IsString()
  @IsNotEmpty()
  cancellationReason: string;
}
