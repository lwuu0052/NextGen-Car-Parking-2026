import { Request, Response, NextFunction } from 'express';
import { webhookValidator, WebhookValidationError } from '../webhooks/validation/webhook-validator.js';
import { eventDispatcher } from '../webhooks/dispatcher/event-dispatcher.js';

export async function handleSimulatorWebhook(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawPayload = req.body;
    const validatedPayload = webhookValidator.validatePayload(rawPayload);

    // Verify optional HMAC signature if configured
    const signatureHeader = req.header('x-signature') || req.header('x-hub-signature');
    const isValidSignature = webhookValidator.verifySignature(validatedPayload, signatureHeader);
    if (!isValidSignature) {
      throw new WebhookValidationError('Invalid Webhook signature');
    }

    const result = await eventDispatcher.dispatch(validatedPayload);

    res.status(200).json({
      status: 'success',
      savedEventId: result.savedEventId,
      externalEventId: result.externalEventId,
      eventClass: result.eventClass,
      isDuplicate: result.isDuplicate,
      processingStatus: result.status,
    });
  } catch (err) {
    next(err);
  }
}
