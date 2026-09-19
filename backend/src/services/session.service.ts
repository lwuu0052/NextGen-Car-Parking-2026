import { sessionRepository, ParkingSessionRecord } from '../repositories/session.repository.js';
import { parkingSpotRepository } from '../repositories/parking-spot.repository.js';

export class SessionService {
  public async startSession(
    plateNumber: string,
    carType: string,
    spotSimulatorName?: string
  ): Promise<ParkingSessionRecord | null> {
    try {
      // Check existing active session
      let existing = await sessionRepository.findActiveSessionByPlate(plateNumber).catch(() => null);
      if (existing) {
        return existing;
      }

      let spotDbId: number | null = null;
      if (spotSimulatorName) {
        const spotRecord = await parkingSpotRepository.findBySimulatorName(spotSimulatorName).catch(() => null);
        if (spotRecord) {
          spotDbId = spotRecord.id;
        }
      }

      return await sessionRepository.createSession({
        plate_number: plateNumber,
        car_type: carType,
        parking_spot_id: spotDbId,
        status: 'heading_to_spot',
        arrived_at: new Date(),
      }).catch(() => null);
    } catch (err: any) {
      console.warn(`[SessionService] Warning: Failed to record start session for ${plateNumber}:`, err.message);
      return null;
    }
  }

  public async markParked(plateNumber: string): Promise<ParkingSessionRecord | null> {
    try {
      const active = await sessionRepository.findActiveSessionByPlate(plateNumber).catch(() => null);
      if (!active) return null;

      const now = new Date();
      return await sessionRepository.updateStatus(active.id, 'parked', {
        parked_at: now,
      }).catch(() => null);
    } catch {
      return null;
    }
  }

  public async markUnparked(plateNumber: string): Promise<ParkingSessionRecord | null> {
    try {
      const active = await sessionRepository.findActiveSessionByPlate(plateNumber).catch(() => null);
      if (!active) return null;

      const now = new Date();
      return await sessionRepository.updateStatus(active.id, 'ready_to_exit', {
        unparked_at: now,
      }).catch(() => null);
    } catch {
      return null;
    }
  }

  public async markDeparted(plateNumber: string): Promise<ParkingSessionRecord | null> {
    try {
      const active = await sessionRepository.findActiveSessionByPlate(plateNumber).catch(() => null);
      if (!active) return null;

      const now = new Date();
      const durationSeconds = Math.max(
        0,
        Math.floor((now.getTime() - new Date(active.arrived_at).getTime()) / 1000)
      );

      return await sessionRepository.updateStatus(active.id, 'departed', {
        departed_at: now,
        parking_duration_seconds: durationSeconds,
      }).catch(() => null);
    } catch {
      return null;
    }
  }

  public async updateAssignedSpot(
    plateNumber: string,
    spotSimulatorName: string
  ): Promise<ParkingSessionRecord | null> {
    try {
      const active = await sessionRepository.findActiveSessionByPlate(plateNumber).catch(() => null);
      if (!active) return null;

      const spotRecord = await parkingSpotRepository.findBySimulatorName(spotSimulatorName).catch(() => null);
      return await sessionRepository.updateParkingSpot(active.id, spotRecord?.id ?? null).catch(() => active);
    } catch {
      return null;
    }
  }
}

export const sessionService = new SessionService();
