import { ComponentFixedEventPayload } from '../models/webhook-event.model.js';
import { deviceRepository } from '../../repositories/device.repository.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';

export async function handleComponentFixed(event: ComponentFixedEventPayload): Promise<void> {
  console.log(`[Webhook Handler] ComponentFixed: Component ${event.ComponentName} fixed`);

  const device = await deviceRepository.findBySimulatorName(event.ComponentName);
  if (device) {
    await deviceRepository.updateState(event.ComponentName, { health_status: 'normal' });
    return;
  }

  const spot = await parkingSpotRepository.findBySimulatorName(event.ComponentName);
  if (spot) {
    await parkingSpotRepository.updateStatuses(event.ComponentName, { health_status: 'normal' });
  }
}
