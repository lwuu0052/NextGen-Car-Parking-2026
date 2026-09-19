import { Request, Response, NextFunction } from 'express';
import { logger } from './logger.middleware.js';
import { DatabaseConnectionError } from '../database/postgres.js';
import { SimulatorAuthError } from '../simulator/auth/token-manager.js';
import { SimulatorTimeoutError, SimulatorResponseError } from '../simulator/client/simulator-client.js';
import { WebhookValidationError } from '../webhooks/validation/webhook-validator.js';

export interface StandardErrorBody {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  requestId: string;
}

export function errorMiddleware(
  err: any,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = req.requestId || 'unknown';
  let statusCode = 500;
  let errorCode = 'INTERNAL_SERVER_ERROR';
  let message = 'An internal server error occurred';

  if (err instanceof DatabaseConnectionError) {
    statusCode = 503;
    errorCode = 'DATABASE_UNAVAILABLE';
    message = 'PostgreSQL database service is currently unavailable';
  } else if (err instanceof SimulatorAuthError) {
    statusCode = 502;
    errorCode = 'SIMULATOR_AUTH_FAILED';
    message = 'Failed to authenticate with simulator';
  } else if (err instanceof SimulatorTimeoutError) {
    statusCode = 504;
    errorCode = 'SIMULATOR_TIMEOUT';
    message = 'Request to simulator timed out';
  } else if (err instanceof SimulatorResponseError) {
    statusCode = 502;
    errorCode = 'SIMULATOR_ERROR';
    message = err.message;
  } else if (err instanceof WebhookValidationError) {
    statusCode = 400;
    errorCode = 'INVALID_WEBHOOK_PAYLOAD';
    message = err.message;
  } else if (err.status && typeof err.status === 'number') {
    statusCode = err.status;
    errorCode = 'HTTP_ERROR';
    message = err.message || 'HTTP Error';
  }

  logger.error({
    requestId,
    errorCode,
    statusCode,
    path: req.originalUrl,
    error: err.message || String(err),
  }, `Error handling request [${errorCode}]`);

  const responseBody: StandardErrorBody = {
    error: {
      code: errorCode,
      message,
    },
    requestId,
  };

  res.status(statusCode).json(responseBody);
}
