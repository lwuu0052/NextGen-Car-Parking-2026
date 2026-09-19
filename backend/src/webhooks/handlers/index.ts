import { BaseWebhookEventPayload } from '../models/webhook-event.model.js';
import { handleCarSpotAction } from './car-spot-action.handler.js';
import { handleGateAction } from './gate-action.handler.js';
import { handleComponentBroken } from './component-broken.handler.js';
import { handleComponentFixed } from './component-fixed.handler.js';
import { handleCarbonMonoxideEvent } from './carbon-monoxide.handler.js';
import { handlePaymentMade } from './payment-made.handler.js';
import { handlePenalty, handleTestWebhook, handleUnknownEvent } from './misc-handlers.js';

export type EventHandlerFunction = (event: any) => Promise<void>;

export const eventHandlerMap: Record<string, EventHandlerFunction> = {
  car_spot_action: handleCarSpotAction,
  gate_action: handleGateAction,
  component_broken: handleComponentBroken,
  component_fixed: handleComponentFixed,
  carbon_monoxide_event: handleCarbonMonoxideEvent,
  payment_made: handlePaymentMade,
  penalty: handlePenalty,
  test_webhook: handleTestWebhook,
};

export function getEventHandler(eventClass: string): EventHandlerFunction {
  if (!eventClass) return handleUnknownEvent;
  
  // Direct lookup first
  if (eventHandlerMap[eventClass]) {
    return eventHandlerMap[eventClass];
  }

  // Convert PascalCase/camelCase (e.g. CarSpotAction -> car_spot_action)
  const snakeCase = eventClass
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase();

  return eventHandlerMap[snakeCase] || handleUnknownEvent;
}

