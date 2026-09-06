import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

export const CorrelationId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.correlationId || '';
  },
);
