import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ImportType, ImportJobStatus } from '@prisma/client';

export class QueryImportDto {
  @IsOptional()
  @IsEnum(ImportType)
  type?: ImportType;

  @IsOptional()
  @IsEnum(ImportJobStatus)
  status?: ImportJobStatus;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
