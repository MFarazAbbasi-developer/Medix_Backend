import {
  IsString,
  IsOptional,
  IsBoolean,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdateWarehouseDto {
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  @Matches(/^[A-Z0-9_-]+$/, {
    message: 'Warehouse code must contain only uppercase letters, numbers, hyphens, and underscores',
  })
  code?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  address?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}
