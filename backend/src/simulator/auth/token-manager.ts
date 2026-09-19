import { config } from '../../config/index.js';
import { SimulatorLoginRequest, SimulatorLoginResponse } from '../models/simulator.model.js';

export class SimulatorAuthError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = 'SimulatorAuthError';
  }
}

export class TokenManager {
  private token: string | null = null;
  private tokenExpiresAt: number | null = null;
  private loginPromise: Promise<string> | null = null;
  private loginFailureCount = 0;
  private readonly maxLoginFailures = 3;

  public async getToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && !this.isTokenExpired()) {
      return this.token;
    }

    // Mutex lock: If a login request is already in-flight, await the same promise
    if (this.loginPromise) {
      return this.loginPromise;
    }

    if (this.loginFailureCount >= this.maxLoginFailures) {
      throw new SimulatorAuthError(
        `Simulator authentication disabled due to ${this.loginFailureCount} consecutive login failures.`
      );
    }

    this.loginPromise = this.performLogin();
    try {
      const token = await this.loginPromise;
      this.loginFailureCount = 0;
      return token;
    } catch (err) {
      this.loginFailureCount++;
      throw err;
    } finally {
      this.loginPromise = null;
    }
  }

  public invalidateToken(): void {
    this.token = null;
    this.tokenExpiresAt = null;
  }

  public resetFailureCount(): void {
    this.loginFailureCount = 0;
  }

  private isTokenExpired(): boolean {
    if (!this.tokenExpiresAt) return false;
    // Consider token expired 10 seconds before actual expiration
    return Date.now() >= this.tokenExpiresAt - 10000;
  }

  private async performLogin(): Promise<string> {
    const loginUrl = `${config.SIMULATOR_BASE_URL.replace(/\/+$/, '')}/api/v1/auth/login`;
    const body: SimulatorLoginRequest = {
      Email: config.SIMULATOR_USERNAME,
      Password: config.SIMULATOR_PASSWORD,
    };

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.SIMULATOR_TIMEOUT_SECONDS * 1000
    );

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new SimulatorAuthError(
          `Simulator login failed with status ${response.status}`,
          response.status
        );
      }

      const data = (await response.json()) as SimulatorLoginResponse;
      if (!data || !data.token) {
        throw new SimulatorAuthError('Simulator login response missing token field');
      }

      this.token = data.token;
      // Default token lifetime: 24 hours if not specified in JWT
      this.tokenExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
      return this.token;
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new SimulatorAuthError(
          `Simulator login timed out after ${config.SIMULATOR_TIMEOUT_SECONDS}s`
        );
      }
      if (err instanceof SimulatorAuthError) {
        throw err;
      }
      throw new SimulatorAuthError(`Simulator login connection error: ${err.message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const tokenManager = new TokenManager();
