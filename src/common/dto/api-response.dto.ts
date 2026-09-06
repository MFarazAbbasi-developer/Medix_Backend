export interface ApiSuccessResponse<T> {
  success: true;
  statusCode: number;
  timestamp: string;
  path: string;
  correlationId: string;
  data: T;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: Record<string, unknown> | unknown[];
}

export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  timestamp: string;
  path: string;
  correlationId: string;
  error: ApiErrorDetail;
}
