import { IsNotEmpty, IsString, IsInt, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class QuarantineMoveDto {
  @IsNotEmpty()
  @IsString()
  sourceWarehouseId: string;

  @IsNotEmpty()
  @IsString()
  destinationWarehouseId: string;

  @IsNotEmpty()
  @IsString()
  batchId: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class QuarantineReleaseDto {
  @IsNotEmpty()
  @IsString()
  sourceWarehouseId: string;

  @IsNotEmpty()
  @IsString()
  destinationWarehouseId: string;

  @IsNotEmpty()
  @IsString()
  batchId: string;

  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number;

  @IsNotEmpty()
  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
