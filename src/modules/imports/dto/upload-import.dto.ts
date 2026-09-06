import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ImportType } from '@prisma/client';

export class UploadImportDto {
  @IsEnum(ImportType, {
    message: `type must be one of: ${Object.values(ImportType).join(', ')}`,
  })
  type: ImportType;

  @IsOptional()
  @IsUUID('4', { message: 'branchId must be a valid UUID' })
  branchId?: string;
}
