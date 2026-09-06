import { describe, it, expect } from 'vitest';
import { validateEnvironment } from './env.validation';

describe('Environment Validation', () => {
  it('should validate valid environment configuration', () => {
    const validConfig = {
      NODE_ENV: 'development',
      PORT: '3000',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/medix_db',
    };

    const result = validateEnvironment(validConfig);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.DATABASE_URL).toBe(
      'postgresql://user:pass@localhost:5432/medix_db',
    );
  });

  it('should throw error when DATABASE_URL is missing', () => {
    const invalidConfig = {
      NODE_ENV: 'development',
      PORT: '3000',
    };

    expect(() => validateEnvironment(invalidConfig)).toThrow(
      /DATABASE_URL is required/,
    );
  });

  it('should apply defaults for optional configuration', () => {
    const minimalConfig = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/medix_db',
    };

    const result = validateEnvironment(minimalConfig);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api');
    expect(result.API_VERSION).toBe('v1');
    expect(result.LOG_LEVEL).toBe('info');
  });
});
