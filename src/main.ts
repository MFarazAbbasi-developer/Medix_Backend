import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfig } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  // Attach Pino Logger
  const logger = app.get(Logger);
  app.useLogger(logger);

  const configService = app.get(ConfigService);
  const config = configService.get<AppConfig>('config') || {
    port: configService.get<number>('PORT', 3000),
    apiPrefix: configService.get<string>('API_PREFIX', 'api'),
    apiVersion: configService.get<string>('API_VERSION', '1'),
    corsAllowedOrigins: (
      configService.get<string>(
        'CORS_ALLOWED_ORIGINS',
        'http://localhost:5173,http://localhost:3000',
      )
    )
      .split(',')
      .map((s) => s.trim()),
    isProduction: configService.get<string>('NODE_ENV') === 'production',
  };

  // Security Middleware
  app.use(helmet());

  // CORS Configuration
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // Allow requests with no origin (like mobile apps, curl, or electron desktop)
      if (!origin) return callback(null, true);

      const allowed =
        config.corsAllowedOrigins.includes(origin) || !config.isProduction;
      if (allowed) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-correlation-id'],
    exposedHeaders: ['x-correlation-id'],
  });

  // Global Prefix & URI Versioning
  app.setGlobalPrefix(config.apiPrefix || 'api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Response Interceptor & Exception Filter
  app.useGlobalInterceptors(new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  const port = config.port || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(
    `🚀 Medix Backend is running on: http://localhost:${port}/${config.apiPrefix || 'api'}/v1`,
  );
}

bootstrap();
