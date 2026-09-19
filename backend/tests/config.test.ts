import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/index.js';

describe('Config Validation Unit Tests', () => {
  it('should successfully load valid configuration', () => {
    const validEnv = {
      APP_HOST: '127.0.0.1',
      APP_PORT: '3000',
      APP_ENV: 'test',
      LOG_LEVEL: 'info',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5432',
      POSTGRES_USER: 'test_user',
      POSTGRES_PASSWORD: 'test_password',
      POSTGRES_DB: 'test_db',
      SIMULATOR_BASE_URL: 'http://127.0.0.1:9898',
      SIMULATOR_USERNAME: 'admin',
      SIMULATOR_PASSWORD: 'admin',
      SIMULATOR_TIMEOUT_SECONDS: '5',
    };

    const config = loadConfig(validEnv);
    expect(config.POSTGRES_HOST).toBe('localhost');
    expect(config.SIMULATOR_BASE_URL).toBe('http://127.0.0.1:9898');
    expect(config.ENABLE_DEVICE_CONTROL_ROUTE).toBe(false);
  });

  it('should fail fast when required environment variables are missing', () => {
    const invalidEnv = {
      APP_HOST: '127.0.0.1',
      // Missing POSTGRES_HOST, SIMULATOR_BASE_URL, etc.
    };

    expect(() => loadConfig(invalidEnv as any)).toThrow('[Config Error]');
  });
});
