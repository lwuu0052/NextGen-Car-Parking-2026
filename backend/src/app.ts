import express, { Express } from 'express';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { loggerMiddleware } from './middleware/logger.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { router } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  // Body parsing with 1MB reasonable size limit
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Middlewares
  app.use(requestIdMiddleware);
  app.use(loggerMiddleware);

  // Mount routes
  app.use(router);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${req.method} ${req.originalUrl} not found`,
      },
      requestId: req.requestId,
    });
  });

  // Error Handler
  app.use(errorMiddleware);

  return app;
}
