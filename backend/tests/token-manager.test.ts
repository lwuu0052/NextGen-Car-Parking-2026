import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenManager } from '../src/simulator/auth/token-manager.js';

describe('TokenManager Unit Tests', () => {
  let tokenManager: TokenManager;

  beforeEach(() => {
    tokenManager = new TokenManager();
  });

  it('should deduplicate concurrent getToken requests using Promise Mutex lock', async () => {
    let fetchCount = 0;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      fetchCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        json: async () => ({ token: 'mock-jwt-token-123' }),
      };
    }));

    // Dispatch 10 concurrent requests for token
    const results = await Promise.all([
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
      tokenManager.getToken(),
    ]);

    expect(fetchCount).toBe(1); // Only 1 HTTP call was dispatched!
    expect(results.every((t) => t === 'mock-jwt-token-123')).toBe(true);

    vi.unstubAllGlobals();
  });
});
