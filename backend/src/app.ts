import express, { Express } from 'express';
import path from 'path';
import { requestIdMiddleware } from './middleware/request-id.middleware.js';
import { loggerMiddleware } from './middleware/logger.middleware.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { router } from './routes/index.js';

export function createApp(): Express {
  const app = express();

  // CORS Middleware
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Body parsing with 1MB reasonable size limit
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Serve static frontend dashboard files
  try {
    const frontendPath = path.resolve(process.cwd(), '../frontend');
    app.use(express.static(frontendPath));
  } catch {
    // Fallback if path resolve fails
  }

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
