import { GateActionEventPayload } from '../models/webhook-event.model.js';
import { deviceRepository } from '../../repositories/device.repository.js';

export async function handleGateAction(event: GateActionEventPayload): Promise<void> {
  console.log(`[Webhook Handler] GateAction: Gate ${event.GateName} state changed to ${event.State}`);

  const device = await deviceRepository.findBySimulatorName(event.GateName);
  if (device) {
    await deviceRepository.updateState(event.GateName, {
      operating_state: event.State,
    });
  }
}
