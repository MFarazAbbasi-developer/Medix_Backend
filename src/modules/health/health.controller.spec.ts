import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HealthData } from './dto/health-response.dto';

describe('HealthController', () => {
  let controller: HealthController;
  let service: HealthService;

  beforeEach(() => {
    service = {
      checkHealth: vi.fn(),
    } as unknown as HealthService;

    controller = new HealthController(service);
  });

  it('should return health status', async () => {
    const mockHealth: HealthData = {
      status: 'ok',
      appName: 'Medix by FARMAX',
      appVersion: '0.1.0',
      environment: 'test',
      uptimeSeconds: 10,
      timestamp: new Date().toISOString(),
      database: {
        status: 'connected',
        type: 'postgresql',
      },
    };

    vi.spyOn(service, 'checkHealth').mockResolvedValue(mockHealth);

    const result = await controller.getHealth();
    expect(result).toEqual(mockHealth);
    expect(result.status).toBe('ok');
    expect(result.database.status).toBe('connected');
  });
});
