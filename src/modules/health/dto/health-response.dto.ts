export interface HealthData {
  status: 'ok' | 'degraded' | 'error';
  appName: string;
  appVersion: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
  database: {
    status: 'connected' | 'disconnected';
    type: 'postgresql';
  };
}
