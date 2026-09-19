import { PenaltyEventPayload, TestWebhookEventPayload, BaseWebhookEventPayload } from '../models/webhook-event.model.js';

export async function handlePenalty(event: PenaltyEventPayload): Promise<void> {
  console.log(`[Webhook Handler] Penalty: Type ${event.PenaltyType}, FineAmount: ${event.FineAmount}`);
}

export async function handleTestWebhook(event: TestWebhookEventPayload): Promise<void> {
  console.log(`[Webhook Handler] TestWebhook received: ${event.Message || 'Test OK'}`);
}

export async function handleUnknownEvent(event: BaseWebhookEventPayload): Promise<void> {
  console.warn(`[Webhook Handler] Unknown event class "${event.EventClass}" persisted to database.`);
}
