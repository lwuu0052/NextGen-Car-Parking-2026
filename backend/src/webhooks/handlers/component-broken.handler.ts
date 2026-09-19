import { ComponentBrokenEventPayload } from '../models/webhook-event.model.js';
import { deviceRepository } from '../../repositories/device.repository.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';

export async function handleComponentBroken(event: ComponentBrokenEventPayload): Promise<void> {
  console.log(`[Webhook Handler] ComponentBroken: Component ${event.ComponentName} is broken`);

  // Check if it's a device
  const device = await deviceRepository.findBySimulatorName(event.ComponentName);
  if (device) {
    await deviceRepository.updateState(event.ComponentName, { health_status: 'broken' });
    return;
  }

  // Check if it's a spot
  const spot = await parkingSpotRepository.findBySimulatorName(event.ComponentName);
  if (spot) {
    await parkingSpotRepository.updateStatuses(event.ComponentName, { health_status: 'broken' });
  }
}
