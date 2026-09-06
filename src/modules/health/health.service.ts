import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { HealthData } from './dto/health-response.dto';
import { APP_NAME } from '../../common/constants';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly startTime = Date.now();

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async checkHealth(): Promise<HealthData> {
    const isDbHealthy = await this.prismaService.isHealthy();
    const uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
    const environment =
      this.configService.get<string>('nodeEnv') || 'development';

    return {
      status: isDbHealthy ? 'ok' : 'degraded',
      appName: APP_NAME,
      appVersion: '0.1.0',
      environment,
      uptimeSeconds,
      timestamp: new Date().toISOString(),
      database: {
        status: isDbHealthy ? 'connected' : 'disconnected',
        type: 'postgresql',
      },
    };
  }
}
