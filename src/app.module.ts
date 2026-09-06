import {
  Module,
  NestModule,
  MiddlewareConsumer,
  RequestMethod,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage } from 'http';
import { configuration, validateEnvironment } from './config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { SettingsModule } from './modules/settings/settings.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CORRELATION_ID_HEADER } from './common/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProd = config.get<string>('nodeEnv') === 'production';
        const logLevel = config.get<string>('logLevel') || 'info';

        return {
          pinoHttp: {
            level: logLevel,
            customProps: (req: IncomingMessage) => {
              const correlationId =
                (req as IncomingMessage & { correlationId?: string })
                  .correlationId ||
                (req.headers[CORRELATION_ID_HEADER] as string) ||
                '';
              return { correlationId };
            },
            transport: isProd
              ? undefined
              : {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    singleLine: true,
                    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
                  },
                },
          },
        };
      },
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    AuditModule,
    OrganizationModule,
    NumberingModule,
    SettingsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
