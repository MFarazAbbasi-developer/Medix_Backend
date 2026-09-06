import {
  IsString,
  IsOptional,
  IsArray,
  IsBoolean,
  MinLength,
  IsNumber,
  Min,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class CreateUserDto {
  @IsString()
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  username!: string;

  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password!: string;

  @IsString()
  @MinLength(2, { message: 'Display name must be at least 2 characters long' })
  displayName!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Display name must be at least 2 characters long' })
  displayName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleIds?: string[];
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(6, { message: 'New password must be at least 6 characters long' })
  newPassword!: string;
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}

export class QueryUserDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  roleId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;
}
