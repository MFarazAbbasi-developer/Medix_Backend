import { IsString, IsOptional, IsEnum, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { GrnStatus } from '@prisma/client';

export class QueryGoodsReceiveNoteDto {
  @IsString()
  @IsOptional()
  search?: string;

  @IsEnum(GrnStatus)
  @IsOptional()
  status?: GrnStatus;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  branchId?: string;

  @IsString()
  @IsOptional()
  warehouseId?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  limit?: number = 50;
}
