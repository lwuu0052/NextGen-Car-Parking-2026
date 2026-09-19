import { CarbonMonoxideEventPayload } from '../models/webhook-event.model.js';
import { zoneRepository } from '../../repositories/zone.repository.js';

export async function handleCarbonMonoxideEvent(event: CarbonMonoxideEventPayload): Promise<void> {
  const levelNum = typeof event.COLevel === 'number' ? event.COLevel : parseFloat(event.COLevel) || 0;
  console.log(`[Webhook Handler] CarbonMonoxideEvent: Zone ${event.ZoneName} CO level is ${levelNum}`);

  const zone = await zoneRepository.findBySimulatorName(event.ZoneName);
  if (zone) {
    await zoneRepository.updateCoLevel(event.ZoneName, levelNum);
  }
}
