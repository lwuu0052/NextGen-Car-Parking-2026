import { simulatorClient } from '../simulator/client/simulator-client.js';
import { SimulatorParkingSpotDto } from '../simulator/models/simulator.model.js';

export interface SpotCandidate {
  spot: SimulatorParkingSpotDto;
  score: number;
  distance: number;
}

export interface ReservedSpotEntry {
  carPlate: string;
  spotName: string;
  reservedAt: number;
}

export class AllocationService {
  private pendingReservations: Map<string, ReservedSpotEntry> = new Map();
  private readonly reservationTTLMs = 180_000; // 3 minutes TTL

  /**
   * Recommends and allocates the optimal parking spot based on car type and distance.
   */
  public async allocateSpot(
    carPlate: string,
    carType: string,
    entryCoords: { x: number; y: number } = { x: 300, y: 900 }
  ): Promise<SimulatorParkingSpotDto | null> {
    this.cleanExpiredReservations();

    const allSpots = await simulatorClient.listParkingSpots();

    // Collect all spot names currently reserved for other cars in transit
    const reservedSpotNames = new Set<string>();
    for (const [spotName, entry] of this.pendingReservations.entries()) {
      if (entry.carPlate !== carPlate) {
        reservedSpotNames.add(spotName);
      }
    }

    // 1. Filter out non-parkable spots (entry/exit spots, occupied, in-flight reserved, maintenance)
    const availableSpots = allSpots.filter((s: any) => {
      const name = s.name || s.Name;
      if (!name) return false;
      const lowerName = name.toLowerCase();
      const purpose = (s.purpose || s.Purpose || '').toLowerCase();

      if (purpose.includes('entry') || purpose.includes('exit') || purpose.includes('leave')) return false;
      if (lowerName.includes('entry') || lowerName.includes('exit') || lowerName.includes('escape')) return false;

      // Exclude physically occupied spots in simulator
      const isOccupied = s.detectedCars !== undefined ? s.detectedCars > 0 : (s.OccupancyStatus === 'Occupied' || s.OccupancyStatus === 'Reserved');
      if (isOccupied) return false;

      // Exclude in-flight reserved spots
      if (reservedSpotNames.has(name)) return false;

      // Exclude broken or under maintenance spots
      const isBroken = s.broken || s.isUnderMaintenance || s.IsRepairRequested || false;
      if (isBroken) return false;

      return true;
    });

    if (availableSpots.length === 0) {
      return null;
    }

    // 2. Score and calculate distance for each candidate spot
    const normCarType = (carType || 'Normal').toLowerCase();

    const candidates: SpotCandidate[] = availableSpots.map((spot: any) => {
      const rawSpotType = spot.parkingForCarType || spot.SpotType || spot.spotType || 'Any';
      const spotType = rawSpotType.toLowerCase();
      let score = 0;

      if (normCarType === 'electric') {
        if (spotType === 'electric') score = 100;
        else if (spotType === 'any') score = 60;
        else score = 10;
      } else if (normCarType === 'accessible') {
        if (spotType === 'accessible') score = 100;
        else if (spotType === 'any') score = 60;
        else score = 10;
      } else {
        // Normal car
        if (spotType === 'any') score = 100;
        else score = 10; // Avoid Electric or Accessible for Normal cars
      }

      // Calculate distance to entry coordinates if X and Y exist
      const posX = spot.x ?? spot.X ?? 1000;
      const posY = spot.y ?? spot.Y ?? 1000;
      const distance = Math.hypot(posX - entryCoords.x, posY - entryCoords.y);

      const normalizedSpot: SimulatorParkingSpotDto = {
        ...spot,
        Name: spot.name || spot.Name,
        SpotType: spot.parkingForCarType || spot.SpotType || 'Any',
      };

      return { spot: normalizedSpot, score, distance };
    });

    // 3. Sort candidates: Higher score first, then shorter distance
    candidates.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.distance - b.distance;
    });

    const chosenSpot = candidates[0].spot;

    // Record in-flight reservation
    if (chosenSpot && chosenSpot.Name) {
      this.pendingReservations.set(chosenSpot.Name, {
        carPlate,
        spotName: chosenSpot.Name,
        reservedAt: Date.now(),
      });
    }

    return chosenSpot;
  }

  public releaseReservation(spotName: string): void {
    if (spotName) {
      this.pendingReservations.delete(spotName);
    }
  }

  public clearAllReservations(): void {
    this.pendingReservations.clear();
  }

  private cleanExpiredReservations(): void {
    const now = Date.now();
    for (const [spotName, entry] of this.pendingReservations.entries()) {
      if (now - entry.reservedAt > this.reservationTTLMs) {
        this.pendingReservations.delete(spotName);
      }
    }
  }
}


export const allocationService = new AllocationService();
