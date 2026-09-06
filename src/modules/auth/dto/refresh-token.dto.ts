import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty({ message: 'Refresh token is required' })
  refreshToken!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  deviceInfo?: string;
}
