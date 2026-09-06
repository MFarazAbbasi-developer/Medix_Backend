import { IsArray, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SettingDataType } from '@prisma/client';

export class SettingItemDto {
  @IsString()
  key: string;

  @IsString()
  value: string;

  @IsOptional()
  @IsEnum(SettingDataType)
  dataType?: SettingDataType;

  @IsOptional()
  @IsString()
  group?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateSettingsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettingItemDto)
  settings: SettingItemDto[];
}
