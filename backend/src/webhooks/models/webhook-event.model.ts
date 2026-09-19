export type WebhookEventClass =
  | 'car_spot_action'
  | 'gate_action'
  | 'component_broken'
  | 'component_fixed'
  | 'carbon_monoxide_event'
  | 'payment_made'
  | 'penalty'
  | 'test_webhook'
  | string;

export interface BaseWebhookEventPayload {
  EventId?: string;
  EventClass: WebhookEventClass;
  SequenceId?: number;
  Signature?: string | null;
  ServerDateTime?: string;
  [key: string]: any;
}

export interface CarSpotActionEventPayload extends BaseWebhookEventPayload {
  EventClass: 'car_spot_action';
  CarPlateNumber: string;
  CarType: string;
  SpotName: string;
  SpotType: string;
  Direction: 'CarIn' | 'CarOut' | string;
  PlannedParkingDurationInMinutes?: string | number;
}

export interface GateActionEventPayload extends BaseWebhookEventPayload {
  EventClass: 'gate_action';
  GateName: string;
  State: 'Open' | 'Closed' | 'Opening' | 'Closing' | string;
}

export interface ComponentBrokenEventPayload extends BaseWebhookEventPayload {
  EventClass: 'component_broken';
  ComponentName: string;
  ComponentType?: string;
}

export interface ComponentFixedEventPayload extends BaseWebhookEventPayload {
  EventClass: 'component_fixed';
  ComponentName: string;
  ComponentType?: string;
}

export interface CarbonMonoxideEventPayload extends BaseWebhookEventPayload {
  EventClass: 'carbon_monoxide_event';
  ZoneName: string;
  COLevel: string | number;
}

export interface PaymentMadeEventPayload extends BaseWebhookEventPayload {
  EventClass: 'payment_made';
  CarPlateNumber: string;
  Amount: number | string;
}

export interface PenaltyEventPayload extends BaseWebhookEventPayload {
  EventClass: 'penalty';
  PenaltyType: string;
  FineAmount: number | string;
}

export interface TestWebhookEventPayload extends BaseWebhookEventPayload {
  EventClass: 'test_webhook';
  Message?: string;
}
