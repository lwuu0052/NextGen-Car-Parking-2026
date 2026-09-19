import crypto from 'crypto';
import { z } from 'zod';
import { config } from '../../config/index.js';
import { BaseWebhookEventPayload } from '../models/webhook-event.model.js';

export class WebhookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookValidationError';
  }
}

const baseEventSchema = z.object({
  EventClass: z.string().min(1, 'EventClass is required'),
  EventId: z.string().optional(),
  SequenceId: z.number().optional(),
  Signature: z.string().nullable().optional(),
  ServerDateTime: z.string().optional(),
}).passthrough();

export class WebhookValidator {
  public validatePayload(payload: any): BaseWebhookEventPayload {
    if (!payload || typeof payload !== 'object') {
      throw new WebhookValidationError('Invalid Webhook request body: Must be a non-null JSON object');
    }

    const parseResult = baseEventSchema.safeParse(payload);
    if (!parseResult.success) {
      const details = parseResult.error.errors.map((e) => e.message).join('; ');
      throw new WebhookValidationError(`Invalid Webhook payload structure: ${details}`);
    }

    return parseResult.data as BaseWebhookEventPayload;
  }

  public verifySignature(payload: BaseWebhookEventPayload, headerSignature?: string): boolean {
    if (!config.WEBHOOK_SECRET) {
      // Secret not configured, skip signature verification
      return true;
    }

    const signatureToTest = headerSignature || payload.Signature;
    if (!signatureToTest) {
      return false;
    }

    try {
      const hmac = crypto.createHmac('sha256', config.WEBHOOK_SECRET);
      hmac.update(JSON.stringify(payload));
      const expectedSignature = hmac.digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(signatureToTest),
        Buffer.from(expectedSignature)
      );
    } catch {
      return false;
    }
  }
}

export const webhookValidator = new WebhookValidator();
