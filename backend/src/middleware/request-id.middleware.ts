import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const existingId = req.header('x-request-id');
  const requestId = existingId && existingId.trim().length > 0 ? existingId : uuidv4();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
