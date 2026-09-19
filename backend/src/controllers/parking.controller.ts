import { Request, Response, NextFunction } from 'express';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { deviceService } from '../services/device.service.js';

export async function getParkingSpots(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const spots = await simulatorClient.listParkingSpots();
    res.status(200).json({
      data: {
        source: 'simulator_realtime',
        count: spots.length,
        parkingSpots: spots,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function getDevices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [barriers, lights, fans] = await Promise.all([
      simulatorClient.listBarriers(),
      simulatorClient.listLights(),
      simulatorClient.listExhaustFans(),
    ]);

    res.status(200).json({
      data: {
        source: 'simulator_realtime',
        devices: {
          barriers,
          lights,
          exhaustFans: fans,
        },
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function postDeviceCommand(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawId = req.params.id;
    const deviceId = Array.isArray(rawId) ? rawId[0] : rawId;
    const { command } = req.body || {};

    if (!command || !['open', 'close', 'repair'].includes(command)) {
      res.status(400).json({
        error: {
          code: 'INVALID_COMMAND',
          message: 'Command must be one of: "open", "close", "repair"',
        },
        requestId: req.requestId,
      });
      return;
    }

    const result = await deviceService.executeCommand(deviceId, command);
    res.status(200).json({
      data: result,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}
