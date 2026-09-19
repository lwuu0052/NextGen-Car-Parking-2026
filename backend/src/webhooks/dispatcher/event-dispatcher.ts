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
    let record: WebhookEventRecord | null = null;
    let isDuplicate = false;

    // 1. Persist raw event to database (with fallback for offline DB during dev)
    try {
      const res = await webhookEventRepository.createEvent({
        external_event_id: externalEventId,
        event_type: eventClass,
        payload: payload,
        occurred_at: payload.ServerDateTime ? new Date(payload.ServerDateTime) : null,
      });
      record = res.record;
      isDuplicate = res.isDuplicate;
    } catch (dbErr: any) {
      console.warn(
        `[EventDispatcher] Database write skipped (${dbErr.message}). Dispatching event in memory...`
      );
    }

    if (isDuplicate && record) {
      console.log(
        `[EventDispatcher] Duplicate event ID "${externalEventId}" ignored.`
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

    // 2. Dispatch event to handler
    const handler = getEventHandler(eventClass);
    try {
      await handler(payload);
      if (record) {
        await webhookEventRepository.updateStatus(record.id, 'processed').catch(() => {});
      }
      return {
        savedEventId: record ? record.id : 0,
        externalEventId,
        eventClass,
        isDuplicate: false,
        status: 'processed',
      };
    } catch (handlerErr: any) {
      const errorMsg = handlerErr.message || String(handlerErr);
      console.error(
        `[EventDispatcher] Error processing event (${eventClass}):`,
        errorMsg
      );
      if (record) {
        await webhookEventRepository.updateStatus(record.id, 'failed', errorMsg).catch(() => {});
      }
      return {
        savedEventId: record ? record.id : 0,
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
