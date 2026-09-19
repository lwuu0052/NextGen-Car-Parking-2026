import { BaseWebhookEventPayload } from '../models/webhook-event.model.js';
import { webhookEventRepository, WebhookEventRecord } from '../../repositories/webhook-event.repository.js';
import { getEventHandler } from '../handlers/index.js';

export interface DispatchResult {
  savedEventId: number;
  externalEventId: string | null;
  eventClass: string;
  isDuplicate: boolean;
  status: 'processed' | 'failed';
  errorMessage?: string;
}

export class EventDispatcher {
  public async dispatch(payload: BaseWebhookEventPayload): Promise<DispatchResult> {
    const externalEventId = payload.EventId || null;
    const eventClass = payload.EventClass;

    // 1. Persist raw event to database BEFORE processing
    const { record, isDuplicate } = await webhookEventRepository.createEvent({
      external_event_id: externalEventId,
      event_type: eventClass,
      payload: payload,
      occurred_at: payload.ServerDateTime ? new Date(payload.ServerDateTime) : null,
    });

    if (isDuplicate) {
      console.log(
        `[EventDispatcher] Duplicate event ID "${externalEventId}" ignored for business processing.`
      );
      return {
        savedEventId: record.id,
        externalEventId,
        eventClass,
        isDuplicate: true,
        status: record.processing_status as 'processed' | 'failed',
        errorMessage: record.error_message || undefined,
      };
    }

    // 2. Dispatch to appropriate handler
    const handler = getEventHandler(eventClass);
    try {
      await handler(payload);
      await webhookEventRepository.updateStatus(record.id, 'processed');
      return {
        savedEventId: record.id,
        externalEventId,
        eventClass,
        isDuplicate: false,
        status: 'processed',
      };
    } catch (handlerErr: any) {
      const errorMsg = handlerErr.message || String(handlerErr);
      console.error(
        `[EventDispatcher] Error processing event ID ${record.id} (${eventClass}):`,
        errorMsg
      );
      await webhookEventRepository.updateStatus(record.id, 'failed', errorMsg);
      return {
        savedEventId: record.id,
        externalEventId,
        eventClass,
        isDuplicate: false,
        status: 'failed',
        errorMessage: errorMsg,
      };
    }
  }
}

export const eventDispatcher = new EventDispatcher();
