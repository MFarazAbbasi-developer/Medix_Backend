import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsOptional,
  IsNumber,
} from 'class-validator';

export class CreateOpeningBalanceDto {
  @IsString()
  @IsNotEmpty()
  warehouseId!: string;

  @IsString()
  @IsNotEmpty()
  productId!: string;

  @IsString()
  @IsNotEmpty()
  batchId!: string;

  @IsInt()
  @Min(1, { message: 'Opening balance quantity must be at least 1' })
  quantity!: number;

  @IsNumber()
  @IsOptional()
  unitCost?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}
