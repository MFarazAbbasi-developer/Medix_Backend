import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCategoryDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateUnitDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  name: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  symbol: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUnitDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  symbol?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
