import { Request, Response, NextFunction } from 'express';
import { exitQueueService } from '../services/exit-queue.service.js';

export async function getExitQueueState(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.status(200).json({
      data: {
        queuedPlates: exitQueueService.getQueuedPlates(),
        heldVehicles: exitQueueService.getHeldVehicles(),
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function forceReleaseHeldVehicle(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawPlate = req.params.plate;
    const plate = Array.isArray(rawPlate) ? rawPlate[0] : rawPlate;
    const result = await exitQueueService.forceRelease(plate);
    res.status(result.success ? 200 : 404).json({
      data: result,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function retryHeldVehiclePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawPlate = req.params.plate;
    const plate = Array.isArray(rawPlate) ? rawPlate[0] : rawPlate;
    const result = await exitQueueService.retryPayment(plate);
    res.status(result.success ? 200 : 409).json({
      data: result,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}
