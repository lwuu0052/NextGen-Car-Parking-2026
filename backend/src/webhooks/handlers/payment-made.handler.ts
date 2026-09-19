import { PaymentMadeEventPayload } from '../models/webhook-event.model.js';

export async function handlePaymentMade(event: PaymentMadeEventPayload): Promise<void> {
  console.log(`[Webhook Handler] PaymentMade: Car ${event.CarPlateNumber} paid amount ${event.Amount}`);
  // Reserved stub for phase 2 billing verification
}
