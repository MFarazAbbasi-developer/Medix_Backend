import { z } from 'zod';

export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api'),
  API_VERSION: z.string().default('v1'),
  DATABASE_URL: z
    .string({ required_error: 'DATABASE_URL is required' })
    .min(1, 'DATABASE_URL is required'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  // JWT Configuration
  JWT_ACCESS_SECRET: z
    .string({ required_error: 'JWT_ACCESS_SECRET is required' })
    .min(16, 'JWT_ACCESS_SECRET must be at least 16 characters')
    .default('medix_dev_access_secret_key_farmax_2026_local'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_SECRET: z
    .string({ required_error: 'JWT_REFRESH_SECRET is required' })
    .min(16, 'JWT_REFRESH_SECRET must be at least 16 characters')
    .default('medix_dev_refresh_secret_key_farmax_2026_local'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

  // Initial Admin Bootstrap Configuration (NO default password for security)
  INITIAL_ADMIN_USERNAME: z.string().default('admin'),
  INITIAL_ADMIN_PASSWORD: z.string().optional(),
  INITIAL_ADMIN_DISPLAY_NAME: z.string().default('System Administrator'),
});

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): EnvironmentConfig {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const errorDetails = result.error.format();
    throw new Error(
      `Config validation error: ${JSON.stringify(errorDetails, null, 2)}`,
    );
  }

  return result.data;
}
