import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDeliveryOrderDto {
  @IsNotEmpty()
  @IsUUID()
  salesInvoiceId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
