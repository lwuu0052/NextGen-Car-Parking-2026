export interface SimulatorLoginRequest {
  Email: string;
  Password: string;
}

export interface SimulatorLoginResponse {
  token: string;
}

export interface SimulatorStatusResponse {
  isActive: boolean;
  cars: number;
}

export interface SimulatorZoneDto {
  Name: string;
  X?: number;
  Y?: number;
  Width?: number;
  Height?: number;
  ZoneType?: string;
  COLevel?: number;
}

export interface SimulatorParkingSpotDto {
  Name: string;
  ZoneParent: string;
  SpotType: 'Any' | 'Electric' | 'Accessible' | string;
  OccupancyStatus?: 'Free' | 'Reserved' | 'Occupied' | string;
  IsRepairRequested?: boolean;
  RepairProgress?: number;
  UsageCounter?: number;
  lastCarPlate?: string | null;
}

export interface SimulatorBarrierDto {
  Name: string;
  ZoneParent: string;
  State: 'Open' | 'Closed' | 'Opening' | 'Closing' | string;
  IsRepairRequested?: boolean;
  RepairProgress?: number;
  UsageCounter?: number;
}

export interface SimulatorLightDto {
  Name: string;
  ZoneParent: string;
  Group: string;
  IsOn: boolean;
  Intensity?: number;
}

export interface SimulatorExhaustFanDto {
  Name: string;
  ZoneParent: string;
  Group?: string;
  IsOn?: boolean;
  IsRepairRequested?: boolean;
}

export interface SimulatorGateCommandResponse {
  success?: boolean;
  message?: string;
  state?: string;
}
