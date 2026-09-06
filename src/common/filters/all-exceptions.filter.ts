import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiErrorResponse } from '../dto/api-response.dto';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errorMessage = 'An unexpected internal server error occurred';
    let errorDetails: Record<string, unknown> | unknown[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        errorMessage = exceptionResponse;
        errorCode = this.statusToErrorCode(status);
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const resObj = exceptionResponse as Record<string, unknown>;
        errorMessage =
          (typeof resObj.message === 'string'
            ? resObj.message
            : Array.isArray(resObj.message)
              ? resObj.message.join(', ')
              : (resObj.error as string)) || exception.message;

        errorCode =
          (resObj.error as string)?.toUpperCase().replace(/\s+/g, '_') ||
          this.statusToErrorCode(status);

        if (Array.isArray(resObj.message)) {
          errorDetails = resObj.message;
        } else if (resObj.details) {
          errorDetails = resObj.details as Record<string, unknown>;
        }
      }
    } else if (exception instanceof Error) {
      const isProd = process.env.NODE_ENV === 'production';
      errorMessage = isProd
        ? 'An unexpected internal server error occurred'
        : exception.message;
      errorCode =
        exception.name?.toUpperCase().replace(/\s+/g, '_') || 'ERROR';

      this.logger.error(
        `Unhandled Exception [${request.correlationId || 'N/A'}]: ${exception.message}`,
        exception.stack,
      );
    }

    const errorPayload: ApiErrorResponse = {
      success: false,
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      correlationId: request.correlationId || '',
      error: {
        code: errorCode,
        message: errorMessage,
        ...(errorDetails ? { details: errorDetails } : {}),
      },
    };

    response.status(status).json(errorPayload);
  }

  private statusToErrorCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}
