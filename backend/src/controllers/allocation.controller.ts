import { Request, Response, NextFunction } from 'express';
import { allocationService } from '../services/allocation.service.js';
import { sessionRepository } from '../repositories/session.repository.js';

export async function recommendSpot(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plateNumber, carType } = req.body || {};

    if (!plateNumber || typeof plateNumber !== 'string') {
      res.status(400).json({
        error: {
          code: 'INVALID_PARAM',
          message: 'plateNumber is required and must be a string',
        },
        requestId: req.requestId,
      });
      return;
    }

    const recommendedSpot = await allocationService.allocateSpot(plateNumber, carType || 'Normal');

    if (!recommendedSpot) {
      res.status(200).json({
        data: {
          allocated: false,
          message: 'No available parking spot matches requirements.',
          recommendedSpot: null,
        },
        requestId: req.requestId,
      });
      return;
    }

    res.status(200).json({
      data: {
        allocated: true,
        recommendedSpot,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function getActiveSessions(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const activeSessions = await sessionRepository.findAllActiveSessions().catch(() => []);
    res.status(200).json({
      data: {
        count: activeSessions.length,
        activeSessions,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}
