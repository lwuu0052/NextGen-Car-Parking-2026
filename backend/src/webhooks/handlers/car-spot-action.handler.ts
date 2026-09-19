import { CarSpotActionEventPayload } from '../models/webhook-event.model.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';
import { simulatorClient } from '../../simulator/client/simulator-client.js';
import { config } from '../../config/index.js';

export async function handleCarSpotAction(event: CarSpotActionEventPayload): Promise<void> {
  console.log(
    `[Webhook Handler] CarSpotAction: Car "${event.CarPlateNumber || 'unknown'}" (${event.CarType || 'Normal'}) ${event.Direction || 'CarIn'} at Spot ${event.SpotName || 'ENTRY1'}`
  );

  // Update spot status in DB if DB is available
  if (event.SpotName) {
    const spot = await parkingSpotRepository.findBySimulatorName(event.SpotName).catch(() => null);
    if (spot) {
      const isOccupied = event.Direction === 'CarIn';
      await parkingSpotRepository.updateStatuses(event.SpotName, {
        occupancy_status: isOccupied ? 'occupied' : 'free',
      }).catch(() => null);
    }
  }

  // Automatic gate opening and spot allocation logic when car arrives at entrance
  if (config.AUTO_OPEN_GATE_ON_ARRIVAL) {
    const isCarIn = event.Direction === 'CarIn';
    const isEntry =
      isCarIn ||
      (event.SpotType && event.SpotType.toLowerCase().includes('entry')) ||
      (event.SpotName && event.SpotName.toLowerCase().includes('entry'));

    if (isEntry) {
      const carPlate = event.CarPlateNumber;
      console.log(
        `[Auto Gate Control] Vehicle "${carPlate || 'car'}" arrived at entrance (${event.SpotName}). Triggering gate open & spot allocation...`
      );

      // 1. Open the entrance gate
      try {
        await simulatorClient.openGate('gateA');
      } catch (err: any) {
        console.error(`[Auto Gate Control] Error opening gateA:`, err.message);
      }

      // Also ensure any closed gate gets opened
      try {
        const barriers = await simulatorClient.listBarriers();
        for (const b of barriers) {
          if (b.State === 'Closed' || b.State === 'Closing') {
            await simulatorClient.openGate(b.Name);
          }
        }
      } catch {
        // Ignored fallback
      }

      // 2. Assign free parking spot to the car so it drives in!
      if (carPlate) {
        try {
          const spots = await simulatorClient.listParkingSpots();
          // Find first available spot that is not occupied and not an entry/exit spot
          const freeSpot = spots.find(
            (s) =>
              s.Name &&
              !s.Name.toLowerCase().includes('entry') &&
              !s.Name.toLowerCase().includes('exit') &&
              s.OccupancyStatus !== 'Occupied' &&
              !s.IsRepairRequested
          );

          if (freeSpot) {
            console.log(
              `[Auto Parking Allocation] Directing car "${carPlate}" to free spot "${freeSpot.Name}"...`
            );
            const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, freeSpot.Name);
            console.log(`[Auto Parking Allocation] Dispatch result:`, dispatchResult);
          } else {
            console.warn(`[Auto Parking Allocation] No free parking spot available for car "${carPlate}".`);
          }
        } catch (err: any) {
          console.error(`[Auto Parking Allocation] Failed to assign spot to car:`, err.message);
        }
      }
    }
  }
}
