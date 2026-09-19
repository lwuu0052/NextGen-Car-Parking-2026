import { CarSpotActionEventPayload } from '../models/webhook-event.model.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';
import { zoneRepository } from '../../repositories/zone.repository.js';

export async function handleCarSpotAction(event: CarSpotActionEventPayload): Promise<void> {
  console.log(
    `[Webhook Handler] CarSpotAction: Car ${event.CarPlateNumber} (${event.CarType}) ${event.Direction} at Spot ${event.SpotName}`
  );

  // If spot exists, update occupancy status
  const spot = await parkingSpotRepository.findBySimulatorName(event.SpotName);
  if (spot) {
    const isOccupied = event.Direction === 'CarIn';
    await parkingSpotRepository.updateStatuses(event.SpotName, {
      occupancy_status: isOccupied ? 'occupied' : 'free',
    });
  }
}
