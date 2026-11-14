import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { inspect } from 'node:util';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { AppError, ErrorBody, ErrorCode } from './app-error';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

@Catch()
export class AppExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(AppExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const [status, body] = this.toResponse(exception);
    host.switchToHttp().getResponse<Response>().status(status).json(body);
  }

  private toResponse(exception: unknown): [number, ErrorBody] {
    if (exception instanceof AppError) {
      const { code, message, details } = exception;
      return [exception.status, { code, message, details }];
    }
    if (exception instanceof ZodValidationException) {
      return [
        400,
        {
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: exception.getZodError(),
        },
      ];
    }
    if (
      exception instanceof HttpException &&
      !(exception instanceof ZodSerializationException)
    ) {
      const status = exception.getStatus();
      if (status < 500) {
        return [
          status,
          {
            code: CODE_BY_STATUS[status] ?? 'BAD_REQUEST',
            message: exception.message,
          },
        ];
      }
    }
    // Unexpected (including a response that doesn't match its declared schema): log it, never leak details.
    // inspect() also prints errors from other realms (e.g. ESM libraries) whose stack Logger shows blank.
    this.logger.error(inspect(exception, { depth: 3 }));
    return [500, { code: 'INTERNAL_ERROR', message: 'Internal server error' }];
  }
}
