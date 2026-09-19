import { CarSpotActionEventPayload } from '../models/webhook-event.model.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';
import { simulatorClient } from '../../simulator/client/simulator-client.js';
import { allocationService } from '../../services/allocation.service.js';
import { sessionService } from '../../services/session.service.js';
import { exitQueueService } from '../../services/exit-queue.service.js';
import { config } from '../../config/index.js';
import { sessionRepository } from '../../repositories/session.repository.js';

const PARKING_PROGRESS_CHECK_MS = 4500;
const MAX_ENTRY_REASSIGN_ATTEMPTS = 2;


export async function handleCarSpotAction(event: CarSpotActionEventPayload): Promise<void> {
  const carPlate = event.CarPlateNumber || (event as any).PlateNumber || (event as any).CarPlate;
  const carType = event.CarType || 'Normal';
  const rawDirection = event.Direction || 'CarIn';
  const spotName = event.SpotName || '';
  const spotType = event.SpotType || '';

  console.log(
    `[Webhook Handler] CarSpotAction: Car "${carPlate || 'unknown'}" (${carType}) ${rawDirection} at Spot "${spotName || 'ENTRY1'}" (${spotType})`
  );

  const normDirection = rawDirection.toLowerCase();
  const isCarIn = normDirection.includes('in') || normDirection.includes('entry') || normDirection === '';
  const isCarOut = normDirection.includes('out') || normDirection.includes('exit');

  const sNameLower = spotName.toLowerCase();
  const sTypeLower = spotType.toLowerCase();

  const isEntrySpot =
    sTypeLower.includes('entry') ||
    sTypeLower.includes('entrance') ||
    sNameLower.includes('entry') ||
    sNameLower.includes('entrance');

  const isExitSpot =
    sTypeLower.includes('exit') ||
    sNameLower.includes('exit');
  const isLeaveSpot =
    sTypeLower.includes('leave') ||
    sNameLower.includes('escape');

  // 1. Update spot status in DB if DB is available
  if (spotName && !isEntrySpot && !isExitSpot && !isLeaveSpot) {
    const spot = await parkingSpotRepository.findBySimulatorName(spotName).catch(() => null);
    if (spot) {
      const isOccupied = isCarIn;
      await parkingSpotRepository.updateStatuses(spotName, {
        occupancy_status: isOccupied ? 'occupied' : 'free',
      }).catch(() => null);
    }
  }

  // 2. Handle Entrance Arrival & Intelligent Spot Allocation
  if (isEntrySpot && isCarIn) {

    if (config.AUTO_OPEN_GATE_ON_ARRIVAL) {
      console.log(
        `[Auto Allocation] Vehicle "${carPlate || 'car'}" arrived at entrance (${spotName}). Running spot allocation algorithm...`
      );

      // Allocate optimal parking spot based on car type & distance
      if (carPlate) {
        try {
          const entryGateName = await findNearestEntryGate(spotName);
          const attemptedSpots = new Set<string>();
          let allocatedSpot = await allocationService.allocateSpotForEntry(carPlate, carType, spotName, attemptedSpots);

          if (allocatedSpot) {
            console.log(
              `[Auto Allocation] Allocated optimal spot "${allocatedSpot.Name}" (${allocatedSpot.SpotType}) to car "${carPlate}" (${carType}).`
            );

            // Open the entrance gate only after a real free spot has been reserved.
            try {
              await simulatorClient.openGate(entryGateName);
            } catch (err: any) {
              console.error(`[Auto Gate Control] Error opening ${entryGateName}:`, err.message);
            }

            // Dispatch car to spot
            let dispatchResult = await simulatorClient.sendCarToSpot(carPlate, allocatedSpot.Name);
            console.log(`[Auto Allocation] Car dispatch result:`, dispatchResult);

            while (!dispatchResult.success && allocatedSpot?.Name) {
              attemptedSpots.add(allocatedSpot.Name);
              allocationService.releaseReservation(allocatedSpot.Name);

              allocatedSpot = await allocationService.allocateSpotForEntry(carPlate, carType, spotName, attemptedSpots);
              if (!allocatedSpot?.Name) {
                break;
              }

              console.log(
                `[Auto Allocation] Retrying "${carPlate}" with next nearest available spot "${allocatedSpot.Name}".`
              );
              dispatchResult = await simulatorClient.sendCarToSpot(carPlate, allocatedSpot.Name);
              console.log(`[Auto Allocation] Retry dispatch result:`, dispatchResult);
            }

            // Issue confirmation dispatch after 300ms to guarantee pathfinding pickup
            if (dispatchResult.success && allocatedSpot?.Name) {
              const finalSpotName = allocatedSpot.Name;
              await sessionService.startSession(carPlate, carType, finalSpotName);

              setTimeout(async () => {
                await simulatorClient.sendCarToSpot(carPlate, finalSpotName).catch(() => {});
              }, 300);
              setTimeout(async () => {
                await simulatorClient.sendCarToSpot(carPlate, finalSpotName).catch(() => {});
              }, 1000);
              scheduleParkingProgressCheck(carPlate, carType, spotName, finalSpotName);
            } else {
              console.warn(`[Auto Allocation] Failed to dispatch "${carPlate}" to any currently available spot.`);
              allocationService.releaseReservationForCar(carPlate);
            }
          } else {
            console.warn(`[Auto Allocation] No suitable parking spot available for car "${carPlate}".`);
          }
        } catch (err: any) {
          console.error(`[Auto Allocation] Error allocating spot:`, err.message);
        }
      }
    }
    return;
  }

  // Handle car passing entrance (moving into facility) -> close entrance gate
  if (isEntrySpot && isCarOut) {
    console.log(`[Auto Gate Control] Vehicle "${carPlate || 'car'}" passed entrance spot "${spotName}". Closing gate.`);
    findNearestEntryGate(spotName).then((gateName) => {
      simulatorClient.closeGate(gateName).catch(() => {});
    }).catch(() => {
      simulatorClient.closeGate('gateA').catch(() => {});
    });
  }

  // 3. Handle car fully leaving the parking lot
  if (isLeaveSpot && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" reached leave spot "${spotName}". Marking departed.`);
    simulatorClient.closeGate('gateB').catch(() => {});
    await sessionService.markDeparted(carPlate);
    return;
  }

  // 4. Handle Car Parked in assigned spot
  if (!isEntrySpot && !isExitSpot && !isLeaveSpot && isCarIn && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" has parked in spot "${spotName}".`);
    simulatorClient.closeGate('gateA').catch(() => {});
    allocationService.releaseReservation(spotName);
    await sessionService.markParked(carPlate);
    return;
  }

  // 5. Handle Car Unparked / Leaving spot
  if (!isEntrySpot && !isExitSpot && !isLeaveSpot && isCarOut && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" has unparked from spot "${spotName}".`);
    allocationService.releaseReservation(spotName);
    await sessionService.markUnparked(carPlate);
    return;
  }


  // 6. Handle Car Exit from parking lot & Payment Request
  if (isExitSpot && carPlate) {
    if (!isCarIn) {
      console.log(
        `[Auto Exit Control] Treating exit event for "${carPlate}" at ${spotName} (${rawDirection}) as exit arrival.`
      );
    }

    console.log(`[Auto Exit Control] Vehicle "${carPlate}" arrived at exit spot (${spotName}). Enqueuing for FIFO exit.`);
    exitQueueService.enqueue(carPlate);

    return;
  }
}

async function findNearestEntryGate(entrySpotName: string): Promise<string> {
  const fallbackGateNames = getFallbackEntryGateNames(entrySpotName);

  try {
    const [spots, barriers] = await Promise.all([
      simulatorClient.listParkingSpots(),
      simulatorClient.listBarriers(),
    ]);
    const barrierNames = barriers.map((gate: any) => gate.Name || gate.name).filter(Boolean);
    const fallbackGate = fallbackGateNames.find((name) => barrierNames.includes(name)) || fallbackGateNames[0];

    const entrySpot = spots.find((spot: any) => (spot.Name || spot.name) === entrySpotName) as any;
    if (!entrySpot) {
      return fallbackGate;
    }

    const entryX = Number(entrySpot.X ?? entrySpot.x);
    const entryY = Number(entrySpot.Y ?? entrySpot.y);
    if (!Number.isFinite(entryX) || !Number.isFinite(entryY)) {
      return fallbackGate;
    }

    const candidates = barriers
      .map((gate: any) => {
        const name = gate.Name || gate.name;
        const x = Number(gate.X ?? gate.x);
        const y = Number(gate.Y ?? gate.y);
        return {
          name,
          distance: Number.isFinite(x) && Number.isFinite(y)
            ? Math.hypot(x - entryX, y - entryY)
            : Number.POSITIVE_INFINITY,
        };
      })
      .filter((gate) => gate.name && Number.isFinite(gate.distance))
      .sort((a, b) => a.distance - b.distance);

    return candidates[0]?.name || fallbackGate;
  } catch {
    return fallbackGateNames[0];
  }
}

function getFallbackEntryGateNames(entrySpotName: string): string[] {
  const lowerName = entrySpotName.toLowerCase();
  if (lowerName.includes('2')) {
    return ['gate3'];
  }
  if (lowerName.includes('3')) {
    return ['gate5'];
  }
  return ['gateA', 'gate1'];
}

function scheduleParkingProgressCheck(
  carPlate: string,
  carType: string,
  entrySpotName: string,
  targetSpotName: string,
  attempt = 0
): void {
  setTimeout(async () => {
    await ensureParkingProgress(carPlate, carType, entrySpotName, targetSpotName, attempt).catch((err: any) => {
      console.error(`[Auto Allocation] Parking progress check failed for "${carPlate}":`, err.message);
    });
  }, PARKING_PROGRESS_CHECK_MS);
}

async function ensureParkingProgress(
  carPlate: string,
  carType: string,
  entrySpotName: string,
  targetSpotName: string,
  attempt: number
): Promise<void> {
  const activeSession = await sessionRepository.findActiveSessionByPlate(carPlate).catch(() => null);
  if (!activeSession || activeSession.status !== 'heading_to_spot') {
    return;
  }

  const spots = await simulatorClient.listParkingSpots().catch(() => []);
  const targetSpot = spots.find((spot: any) => (spot.Name || spot.name) === targetSpotName) as any;

  if (targetSpot && isSpotOccupiedByCar(targetSpot, carPlate)) {
    console.log(`[Auto Allocation] "${carPlate}" reached assigned spot "${targetSpotName}". Marking parked.`);
    allocationService.releaseReservation(targetSpotName);
    await sessionService.markParked(carPlate);
    return;
  }

  const targetBlocked = targetSpot ? isSpotOccupied(targetSpot) : true;
  if (!targetBlocked && attempt === 0) {
    console.log(`[Auto Allocation] "${carPlate}" has not parked yet. Re-sending target "${targetSpotName}".`);
    await simulatorClient.sendCarToSpot(carPlate, targetSpotName).catch(() => {});
    scheduleParkingProgressCheck(carPlate, carType, entrySpotName, targetSpotName, attempt + 1);
    return;
  }

  const excludedSpots = new Set<string>([targetSpotName]);
  allocationService.releaseReservation(targetSpotName);

  const replacementSpot = await allocationService.allocateSpotForEntry(
    carPlate,
    carType,
    entrySpotName,
    excludedSpots
  );

  if (!replacementSpot?.Name) {
    console.warn(
      `[Auto Allocation] "${carPlate}" still has not parked, but no replacement spot is currently available.`
    );
    await simulatorClient.sendCarToSpot(carPlate, targetSpotName).catch(() => {});
    return;
  }

  const gateName = await findNearestEntryGate(entrySpotName);
  await simulatorClient.openGate(gateName).catch(() => {});

  console.log(
    `[Auto Allocation] Reassigning "${carPlate}" from "${targetSpotName}" to available spot "${replacementSpot.Name}".`
  );
  const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, replacementSpot.Name);
  console.log(`[Auto Allocation] Reassignment dispatch result:`, dispatchResult);

  if (!dispatchResult.success) {
    allocationService.releaseReservation(replacementSpot.Name);
    await simulatorClient.sendCarToSpot(carPlate, targetSpotName).catch(() => {});
    return;
  }

  await sessionService.updateAssignedSpot(carPlate, replacementSpot.Name);
  setTimeout(async () => {
    await simulatorClient.sendCarToSpot(carPlate, replacementSpot.Name).catch(() => {});
  }, 500);

  if (attempt + 1 < MAX_ENTRY_REASSIGN_ATTEMPTS) {
    scheduleParkingProgressCheck(carPlate, carType, entrySpotName, replacementSpot.Name, attempt + 1);
  }
}

function isSpotOccupied(spot: any): boolean {
  const detectedCars = Number(spot.detectedCars ?? spot.DetectedCars ?? spot.CarCount ?? 0);
  const occupancyStatus = (spot.OccupancyStatus || spot.occupancyStatus || '').toLowerCase();
  return detectedCars > 0 || occupancyStatus === 'occupied' || occupancyStatus === 'reserved';
}

function isSpotOccupiedByCar(spot: any, carPlate: string): boolean {
  const lastCarPlate = spot.lastCarPlate || spot.LastCarPlate || spot.CarPlateNumber;
  return isSpotOccupied(spot) && lastCarPlate === carPlate;
}



