import { PaymentMadeEventPayload } from '../models/webhook-event.model.js';
import { billingService } from '../../services/billing.service.js';

export async function handlePaymentMade(event: PaymentMadeEventPayload): Promise<void> {
  const carPlate = event.CarPlateNumber || (event as any).PlateNumber || (event as any).CarPlate;
  console.log(`[Webhook Handler] PaymentMade: Car "${carPlate || 'unknown'}" paid amount ${event.Amount}`);

  const result = await billingService.processPaymentEvent(event);
  if (!result.success) {
    console.warn(`[Webhook Handler] PaymentMade processing failed for Car "${carPlate}": ${result.reason}`);
  }
}

