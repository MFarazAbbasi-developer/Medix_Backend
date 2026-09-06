import { IsString, IsNotEmpty } from 'class-validator';

export class CancelSalesInvoiceDto {
  @IsString()
  @IsNotEmpty()
  cancellationReason: string;
}
