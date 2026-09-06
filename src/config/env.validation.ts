import { z } from 'zod';

export const environmentSchema = z
  .object({
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
  })
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        const defaultAccessSecret =
          'medix_dev_access_secret_key_farmax_2026_local';
        const defaultRefreshSecret =
          'medix_dev_refresh_secret_key_farmax_2026_local';
        if (
          data.JWT_ACCESS_SECRET === defaultAccessSecret ||
          data.JWT_REFRESH_SECRET === defaultRefreshSecret
        ) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'Default development JWT secrets are prohibited in production. Configure secure JWT_ACCESS_SECRET and JWT_REFRESH_SECRET environment variables.',
      path: ['JWT_ACCESS_SECRET'],
    },
  )
  .refine(
    (data) => {
      if (data.NODE_ENV === 'production') {
        return data.JWT_ACCESS_SECRET !== data.JWT_REFRESH_SECRET;
      }
      return true;
    },
    {
      message:
        'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must not be identical in production.',
      path: ['JWT_REFRESH_SECRET'],
    },
  );

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
