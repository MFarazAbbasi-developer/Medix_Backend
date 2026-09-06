import { IsString, IsOptional, IsArray, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @MinLength(2, { message: 'Role name must be at least 2 characters long' })
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Role name must be at least 2 characters long' })
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionCodes?: string[];
}
