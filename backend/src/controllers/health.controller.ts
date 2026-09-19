import { Request, Response, NextFunction } from 'express';
import { db } from '../database/postgres.js';

export async function getLiveHealth(req: Request, res: Response): Promise<void> {
  res.status(200).json({
    data: {
      status: 'UP',
      timestamp: new Date().toISOString(),
    },
    requestId: req.requestId,
  });
}

export async function getReadyHealth(req: Request, res: Response): Promise<void> {
  const dbReady = await db.isReady();

  if (dbReady) {
    res.status(200).json({
      data: {
        status: 'READY',
        database: 'UP',
        timestamp: new Date().toISOString(),
      },
      requestId: req.requestId,
    });
  } else {
    res.status(503).json({
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'PostgreSQL database connection pool is not ready',
      },
      data: {
        status: 'NOT_READY',
        database: 'DOWN',
        timestamp: new Date().toISOString(),
      },
      requestId: req.requestId,
    });
  }
}
