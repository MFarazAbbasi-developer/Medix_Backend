import { IsUUID, IsNotEmpty, IsInt, Min } from 'class-validator';

export class PreviewTransferFefoDto {
  @IsUUID()
  @IsNotEmpty()
  sourceWarehouseId: string;

  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
