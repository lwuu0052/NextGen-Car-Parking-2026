import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Provide default test environment fallback if running under test runner
if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
  process.env.POSTGRES_HOST = process.env.POSTGRES_HOST || '127.0.0.1';
  process.env.POSTGRES_PORT = process.env.POSTGRES_PORT || '5432';
  process.env.POSTGRES_USER = process.env.POSTGRES_USER || 'postgres';
  process.env.POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || 'postgres';
  process.env.POSTGRES_DB = process.env.POSTGRES_DB || 'parking_db';
  process.env.SIMULATOR_BASE_URL = process.env.SIMULATOR_BASE_URL || 'http://127.0.0.1:9898';
  process.env.SIMULATOR_USERNAME = process.env.SIMULATOR_USERNAME || 'admin';
  process.env.SIMULATOR_PASSWORD = process.env.SIMULATOR_PASSWORD || 'admin';
}

const configSchema = z.object({
  APP_HOST: z.string().default('0.0.0.0'),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  APP_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  POSTGRES_HOST: z.string().min(1, 'POSTGRES_HOST is required'),
  POSTGRES_PORT: z.coerce.number().int().positive().default(5432),
  POSTGRES_USER: z.string().min(1, 'POSTGRES_USER is required'),
  POSTGRES_PASSWORD: z.string().min(1, 'POSTGRES_PASSWORD is required'),
  POSTGRES_DB: z.string().min(1, 'POSTGRES_DB is required'),

  SIMULATOR_BASE_URL: z.string().url('SIMULATOR_BASE_URL must be a valid HTTP URL'),
  SIMULATOR_USERNAME: z.string().min(1, 'SIMULATOR_USERNAME is required'),
  SIMULATOR_PASSWORD: z.string().min(1, 'SIMULATOR_PASSWORD is required'),
  SIMULATOR_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(5),

  WEBHOOK_SECRET: z.string().optional().default(''),
  ENABLE_DEVICE_CONTROL_ROUTE: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean()
  ).default(false),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
    throw new Error(`[Config Error] Missing or invalid configuration: ${errorMessages}`);
  }
  return result.data;
}

export const config = loadConfig();
