import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';
import { HealthData } from './dto/health-response.dto';

@Controller({
  path: 'health',
  version: '1',
})
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  async getHealth(): Promise<HealthData> {
    return this.healthService.checkHealth();
  }
}
