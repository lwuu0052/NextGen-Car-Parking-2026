import { config } from '../../config/index.js';
import { tokenManager, SimulatorAuthError } from '../auth/token-manager.js';
import {
  SimulatorStatusResponse,
  SimulatorZoneDto,
  SimulatorParkingSpotDto,
  SimulatorBarrierDto,
  SimulatorLightDto,
  SimulatorExhaustFanDto,
  SimulatorGateCommandResponse,
} from '../models/simulator.model.js';

export class SimulatorTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulatorTimeoutError';
  }
}

export class SimulatorResponseError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly body?: any) {
    super(message);
    this.name = 'SimulatorResponseError';
  }
}

export interface GateActionResult {
  accepted: boolean;
  actionCompleted: boolean;
  gateState?: string;
  message: string;
}

export class SimulatorClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.baseUrl = config.SIMULATOR_BASE_URL.replace(/\/+$/, '');
    this.timeoutMs = config.SIMULATOR_TIMEOUT_SECONDS * 1000;
  }

  // --- Public Status Endpoint (No Auth) ---
  public async getStatus(): Promise<SimulatorStatusResponse> {
    return this.requestWithRetry<SimulatorStatusResponse>('GET', '/api/v1/status', false);
  }

  // --- Protected Query Endpoints (Safe GETs with Retries) ---
  public async listZones(): Promise<SimulatorZoneDto[]> {
    return this.requestWithRetry<SimulatorZoneDto[]>('GET', '/api/v1/list-zones', true);
  }

  public async listParkingSpots(): Promise<SimulatorParkingSpotDto[]> {
    return this.requestWithRetry<SimulatorParkingSpotDto[]>('GET', '/api/v1/list-parking-spots', true);
  }

  public async listBarriers(): Promise<SimulatorBarrierDto[]> {
    return this.requestWithRetry<SimulatorBarrierDto[]>('GET', '/api/v1/list-barriers', true);
  }

  public async listLights(): Promise<SimulatorLightDto[]> {
    return this.requestWithRetry<SimulatorLightDto[]>('GET', '/api/v1/list-lights', true);
  }

  public async listExhaustFans(): Promise<SimulatorExhaustFanDto[]> {
    return this.requestWithRetry<SimulatorExhaustFanDto[]>('GET', '/api/v1/list-exhaust-fans', true);
  }

  // --- Car Navigation & Spot Dispatch ---
  public async sendCarToSpot(carName: string, spotName: string): Promise<{ success: boolean; message: string }> {
    const path = `/api/v1/car/${encodeURIComponent(carName)}/goto/${encodeURIComponent(spotName)}`;
    try {
      await this.rawRequest('POST', path, undefined, true);
      return { success: true, message: `Car ${carName} dispatched to spot ${spotName}` };
    } catch (err: any) {
      return { success: false, message: `Failed to dispatch car ${carName} to ${spotName}: ${err.message}` };
    }
  }

  public async chargeCar(
    carName: string,
    parkingCost: number,
    chargingCost: number
  ): Promise<{ success: boolean; message: string }> {
    const params = new URLSearchParams({
      parkingCost: String(parkingCost),
      chargingCost: String(chargingCost),
    });
    const path = `/api/v1/car/${encodeURIComponent(carName)}/charge?${params.toString()}`;

    try {
      await this.rawRequest('POST', path, undefined, true);
      return {
        success: true,
        message: `Payment requested from car ${carName} for parking=${parkingCost}, charging=${chargingCost}`,
      };
    } catch (err: any) {
      return { success: false, message: `Failed to charge car ${carName}: ${err.message}` };
    }
  }

  // --- Gate Control Commands (State-Mutating POSTs - NEVER Blindly Retry) ---
  public async openGate(gateName: string): Promise<GateActionResult> {
    return this.executeGateControl(gateName, 'open', 'Open');
  }

  public async closeGate(gateName: string): Promise<GateActionResult> {
    return this.executeGateControl(gateName, 'close', 'Closed');
  }

  public async waitForGateState(
    gateName: string,
    expectedState: string,
    timeoutMs = 3000,
    intervalMs = 200
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      try {
        const barriers = await this.listBarriers();
        const gate = barriers.find((b: any) => (b.Name || b.name) === gateName);
        const state = (gate as any)?.State || (gate as any)?.state;
        if (state === expectedState) {
          return true;
        }
      } catch {
        // Keep polling until timeout; callers already handle a false result.
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
  }

  public async repairGate(gateName: string): Promise<GateActionResult> {
    return this.executeGateControl(gateName, 'repair', 'Closed');
  }

  public async repairParkingSpot(spotName: string): Promise<{ accepted: boolean; message: string }> {
    const path = `/api/v1/parking-spots/${encodeURIComponent(spotName)}/repair`;
    try {
      await this.rawRequest('POST', path, undefined, true);
      return { accepted: true, message: `Repair requested for parking spot ${spotName}` };
    } catch (err: any) {
      return { accepted: false, message: `Failed to request repair: ${err.message}` };
    }
  }

  // --- Helper Methods ---
  private async executeGateControl(
    gateName: string,
    action: 'open' | 'close' | 'repair',
    expectedState: string
  ): Promise<GateActionResult> {
    const path = `/api/v1/barrier-gates/${encodeURIComponent(gateName)}/${action}`;

    try {
      const response = await this.rawRequest<SimulatorGateCommandResponse>('POST', path, undefined, true);
      return {
        accepted: true,
        actionCompleted: response?.state === expectedState,
        gateState: response?.state,
        message: `Gate ${gateName} ${action} command accepted`,
      };
    } catch (err: any) {
      if (err instanceof SimulatorTimeoutError) {
        try {
          const barriers = await this.listBarriers();
          const gate = barriers.find((b) => b.Name === gateName);
          if (gate && gate.State === expectedState) {
            return {
              accepted: true,
              actionCompleted: true,
              gateState: gate.State,
              message: `Gate ${gateName} ${action} completed (verified via status query after timeout)`,
            };
          }
        } catch {
          // Status query failed
        }

        return {
          accepted: false,
          actionCompleted: false,
          message: `Gate ${gateName} ${action} timed out. State is indeterminate.`,
        };
      }

      throw err;
    }
  }

  private async requestWithRetry<T>(
    method: 'GET' | 'POST',
    path: string,
    requiresAuth = true,
    maxRetries = 2
  ): Promise<T> {
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt <= maxRetries) {
      try {
        return await this.rawRequest<T>(method, path, undefined, requiresAuth);
      } catch (err: any) {
        lastError = err;

        if (err instanceof SimulatorAuthError || (err instanceof SimulatorResponseError && err.statusCode >= 400 && err.statusCode < 500)) {
          throw err;
        }

        attempt++;
        if (attempt <= maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 200));
        }
      }
    }

    throw lastError || new Error(`Request to ${path} failed after ${maxRetries} retries`);
  }

  private async rawRequest<T>(
    method: string,
    path: string,
    body?: any,
    requiresAuth = true,
    isRetryForAuth = false
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (requiresAuth) {
      const token = await tokenManager.getToken();
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (response.status === 401 && requiresAuth && !isRetryForAuth) {
        tokenManager.invalidateToken();
        return this.rawRequest<T>(method, path, body, requiresAuth, true);
      }

      if (!response.ok) {
        let errBody: any;
        try {
          errBody = await response.json();
        } catch {
          errBody = await response.text().catch(() => null);
        }
        throw new SimulatorResponseError(
          `Simulator HTTP ${response.status} on ${method} ${path}`,
          response.status,
          errBody
        );
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return (await response.json()) as T;
      }
      return (await response.text()) as unknown as T;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new SimulatorTimeoutError(`Request to ${method} ${path} timed out after ${config.SIMULATOR_TIMEOUT_SECONDS}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const simulatorClient = new SimulatorClient();
