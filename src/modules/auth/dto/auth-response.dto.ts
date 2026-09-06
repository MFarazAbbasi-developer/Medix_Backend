export interface AuthUserDto {
  id: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

export interface LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: string;
  user: AuthUserDto;
}

export interface RefreshResponseDto {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
  tokenType: string;
}

export interface CurrentUserResponseDto {
  id: string;
  username: string;
  displayName: string;
  status: string;
  roles: string[];
  permissions: string[];
  lastLoginAt: Date | null;
}
