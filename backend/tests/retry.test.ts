import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulatorClient, SimulatorTimeoutError } from '../src/simulator/client/simulator-client.js';
import { tokenManager } from '../src/simulator/auth/token-manager.js';

describe('SimulatorClient Retry & Timeout Safety Tests', () => {
  let client: SimulatorClient;

  beforeEach(() => {
    client = new SimulatorClient();
    vi.spyOn(tokenManager, 'getToken').mockResolvedValue('mock-jwt-token');
  });

  it('should retry GET queries up to 2 times on 500 server error', async () => {
    let callCount = 0;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 3) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => [{ Name: 'ZONE1' }],
      };
    }));

    const zones = await client.listZones();
    expect(callCount).toBe(3); // 1 initial + 2 retries
    expect(zones.length).toBe(1);

    vi.unstubAllGlobals();
  });

  it('should NOT retry POST gate control command on timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      const err = new Error('AbortError');
      err.name = 'AbortError';
      throw err;
    }));

    // Mock listBarriers status check query after control timeout
    vi.spyOn(client, 'listBarriers').mockResolvedValue([
      { Name: 'gateA', ZoneParent: 'ZONE1', State: 'Closed' },
    ]);

    const result = await client.openGate('gateA');
    // Open gate expected State: 'Open', but state query returned 'Closed'
    expect(result.accepted).toBe(false);
    expect(result.actionCompleted).toBe(false);
    expect(result.message).toContain('timed out');

    vi.unstubAllGlobals();
  });
});
