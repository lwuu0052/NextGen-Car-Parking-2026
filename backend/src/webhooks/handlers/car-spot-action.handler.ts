import { CarSpotActionEventPayload } from '../models/webhook-event.model.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';
import { simulatorClient } from '../../simulator/client/simulator-client.js';
import { config } from '../../config/index.js';

export async function handleCarSpotAction(event: CarSpotActionEventPayload): Promise<void> {
  console.log(
    `[Webhook Handler] CarSpotAction: Car ${event.CarPlateNumber || 'unknown'} (${event.CarType || 'Normal'}) ${event.Direction || 'CarIn'} at Spot ${event.SpotName || 'ENTRY1'}`
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

  // Automatic gate opening logic when car arrives at entrance
  if (config.AUTO_OPEN_GATE_ON_ARRIVAL) {
    const isCarIn = event.Direction === 'CarIn';
    const isEntry =
      isCarIn ||
      (event.SpotType && event.SpotType.toLowerCase().includes('entry')) ||
      (event.SpotName && event.SpotName.toLowerCase().includes('entry'));

    if (isEntry) {
      console.log(
        `[Auto Gate Control] Vehicle ${event.CarPlateNumber || 'car'} arrived at entrance (${event.SpotName}). Opening gate...`
      );

      // Attempt to open gateA directly
      try {
        const resultA = await simulatorClient.openGate('gateA');
        console.log(`[Auto Gate Control] gateA open result:`, resultA);
      } catch (err: any) {
        console.error(`[Auto Gate Control] Error opening gateA:`, err.message);
      }

      // Also attempt to query all barriers and open any closed gate
      try {
        const barriers = await simulatorClient.listBarriers();
        for (const b of barriers) {
          if (b.State === 'Closed' || b.State === 'Closing') {
            console.log(`[Auto Gate Control] Opening closed gate ${b.Name}...`);
            await simulatorClient.openGate(b.Name);
          }
        }
      } catch (err: any) {
        // Ignored fallback
      }
    }
  }
}
