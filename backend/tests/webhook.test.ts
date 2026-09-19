import { describe, it, expect, vi } from 'vitest';
import { webhookValidator } from '../src/webhooks/validation/webhook-validator.js';
import { eventDispatcher } from '../src/webhooks/dispatcher/event-dispatcher.js';
import { webhookEventRepository } from '../src/repositories/webhook-event.repository.js';

describe('Webhook Engine Unit & Integration Tests', () => {
  it('should validate valid event payload structure', () => {
    const validEvent = {
      EventClass: 'car_spot_action',
      EventId: '550e8400-e29b-41d4-a716-446655440000',
      CarPlateNumber: 'CQL 105',
      CarType: 'Normal',
      SpotName: 'ENTRY1',
      SpotType: 'EntrySpot',
      Direction: 'CarIn',
    };

    const validated = webhookValidator.validatePayload(validEvent);
    expect(validated.EventClass).toBe('car_spot_action');
    expect(validated.EventId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('should reject invalid event payload missing EventClass', () => {
    const invalidEvent = {
      CarPlateNumber: 'CQL 105',
    };

    expect(() => webhookValidator.validatePayload(invalidEvent)).toThrow('Invalid Webhook payload structure');
  });

  it('should handle duplicate external_event_id without re-executing handler', async () => {
    vi.spyOn(webhookEventRepository, 'createEvent').mockResolvedValue({
      record: {
        id: 101,
        external_event_id: 'dup-id-123',
        event_type: 'car_spot_action',
        payload: {},
        occurred_at: null,
        received_at: new Date(),
        processing_status: 'processed',
        processed_at: new Date(),
        error_message: null,
      },
      isDuplicate: true,
    });

    const result = await eventDispatcher.dispatch({
      EventClass: 'car_spot_action',
      EventId: 'dup-id-123',
      CarPlateNumber: 'ABC 123',
    } as any);

    expect(result.isDuplicate).toBe(true);
    expect(result.status).toBe('processed');
  });
});
