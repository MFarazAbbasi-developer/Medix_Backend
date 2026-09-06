export interface JwtConfig {
  accessSecret: string;
  accessExpiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

export interface InitialAdminConfig {
  username: string;
  password?: string;
  displayName: string;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  apiPrefix: string;
  apiVersion: string;
  databaseUrl: string;
  corsAllowedOrigins: string[];
  logLevel: string;
  jwt: JwtConfig;
  initialAdmin: InitialAdminConfig;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
}

export default (): AppConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const originsStr =
    process.env.CORS_ALLOWED_ORIGINS ||
    'http://localhost:5173,http://localhost:3000';
  const corsAllowedOrigins = originsStr
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    nodeEnv,
    port: parseInt(process.env.PORT || '3000', 10),
    apiPrefix: process.env.API_PREFIX || 'api',
    apiVersion: process.env.API_VERSION || 'v1',
    databaseUrl: process.env.DATABASE_URL || '',
    corsAllowedOrigins,
    logLevel:
      process.env.LOG_LEVEL || (nodeEnv === 'production' ? 'info' : 'debug'),
    jwt: {
      accessSecret:
        process.env.JWT_ACCESS_SECRET ||
        'medix_dev_access_secret_key_farmax_2026_local',
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      refreshSecret:
        process.env.JWT_REFRESH_SECRET ||
        'medix_dev_refresh_secret_key_farmax_2026_local',
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    initialAdmin: {
      username: process.env.INITIAL_ADMIN_USERNAME || 'admin',
      password: process.env.INITIAL_ADMIN_PASSWORD,
      displayName:
        process.env.INITIAL_ADMIN_DISPLAY_NAME || 'System Administrator',
    },
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
  };
};
