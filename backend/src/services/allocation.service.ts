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
  private readonly reservationTTLMs = 45_000;

  /**
   * Recommends and allocates the optimal parking spot based on car type and distance.
   */
  public async allocateSpot(
    carPlate: string,
    carType: string,
    entryCoords: { x: number; y: number } = { x: 300, y: 900 },
    excludedSpotNames: Set<string> = new Set()
  ): Promise<SimulatorParkingSpotDto | null> {
    const candidates = await this.getSpotCandidates(carPlate, carType, entryCoords, excludedSpotNames);
    const chosenSpot = candidates[0]?.spot || null;

    if (chosenSpot?.Name) {
      this.reserveSpot(chosenSpot.Name, carPlate);
    }

    return chosenSpot;
  }

  public async allocateSpotForEntry(
    carPlate: string,
    carType: string,
    entrySpotName: string,
    excludedSpotNames: Set<string> = new Set()
  ): Promise<SimulatorParkingSpotDto | null> {
    this.cleanExpiredReservations();

    const allSpots = await simulatorClient.listParkingSpots();
    const entrySpot = allSpots.find((spot: any) => {
      const name = spot.Name || spot.name;
      return name === entrySpotName;
    }) as any;

    const entryCoords = {
      x: Number(entrySpot?.X ?? entrySpot?.x ?? 300),
      y: Number(entrySpot?.Y ?? entrySpot?.y ?? 900),
    };

    const candidates = this.buildSpotCandidates(allSpots, carPlate, carType, entryCoords, excludedSpotNames);
    const chosenSpot = candidates[0]?.spot || null;

    if (chosenSpot?.Name) {
      this.reserveSpot(chosenSpot.Name, carPlate);
    }

    return chosenSpot;
  }

  public async getSpotCandidates(
    carPlate: string,
    carType: string,
    entryCoords: { x: number; y: number } = { x: 300, y: 900 },
    excludedSpotNames: Set<string> = new Set()
  ): Promise<SpotCandidate[]> {
    this.cleanExpiredReservations();

    const allSpots = await simulatorClient.listParkingSpots();
    return this.buildSpotCandidates(allSpots, carPlate, carType, entryCoords, excludedSpotNames);
  }

  private buildSpotCandidates(
    allSpots: SimulatorParkingSpotDto[],
    carPlate: string,
    carType: string,
    entryCoords: { x: number; y: number },
    excludedSpotNames: Set<string>
  ): SpotCandidate[] {
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
      if (excludedSpotNames.has(name)) return false;
      const lowerName = name.toLowerCase();
      const purpose = (s.purpose || s.Purpose || s.SpotType || '').toLowerCase();

      if (purpose.includes('entry') || purpose.includes('exit') || purpose.includes('leave')) return false;
      if (lowerName.includes('entry') || lowerName.includes('exit') || lowerName.includes('escape')) return false;

      // Exclude physically occupied spots in simulator
      const detectedCars = Number(s.detectedCars ?? s.DetectedCars ?? s.CarCount ?? 0);
      const occupancyStatus = (s.OccupancyStatus || s.occupancyStatus || '').toLowerCase();
      const isOccupied =
        detectedCars > 0 ||
        occupancyStatus === 'occupied' ||
        occupancyStatus === 'reserved' ||
        Boolean(s.lastCarPlate);
      if (isOccupied) return false;

      // Exclude in-flight reserved spots
      if (reservedSpotNames.has(name)) return false;

      // Exclude broken or under maintenance spots
      const isBroken = s.broken || s.isUnderMaintenance || s.IsRepairRequested || false;
      if (isBroken) return false;

      return true;
    });

    if (availableSpots.length === 0) {
      return [];
    }

    // 2. Score and calculate distance for each candidate spot
    const normCarType = (carType || 'Normal').toLowerCase();

    const candidates: SpotCandidate[] = availableSpots.map((spot: any) => {
      const rawSpotType = spot.parkingForCarType || spot.CarType || spot.SpotType || spot.spotType || 'Any';
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
        SpotType: spot.parkingForCarType || spot.CarType || spot.SpotType || 'Any',
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

    return candidates;
  }

  public releaseReservation(spotName: string): void {
    if (spotName) {
      this.pendingReservations.delete(spotName);
    }
  }

  public releaseReservationForCar(carPlate: string): void {
    for (const [spotName, entry] of this.pendingReservations.entries()) {
      if (entry.carPlate === carPlate) {
        this.pendingReservations.delete(spotName);
      }
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

  private reserveSpot(spotName: string, carPlate: string): void {
    this.releaseReservationForCar(carPlate);
    this.pendingReservations.set(spotName, {
      carPlate,
      spotName,
      reservedAt: Date.now(),
    });
  }
}


export const allocationService = new AllocationService();
