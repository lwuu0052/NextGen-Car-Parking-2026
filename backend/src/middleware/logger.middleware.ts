import { Request, Response, NextFunction } from 'express';
import { pino } from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-api-key"]',
      'password',
      'token',
      'Password',
      'Token',
      'secret',
      'POSTGRES_PASSWORD',
      'SIMULATOR_PASSWORD',
    ],
    censor: '[REDACTED]',
  },
  transport:
    config.APP_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: { colorize: true },
        }
      : undefined,
});

export function loggerMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    logger.info({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
    }, `HTTP ${req.method} ${req.originalUrl} ${res.statusCode} - ${durationMs}ms`);
  });

  next();
}
