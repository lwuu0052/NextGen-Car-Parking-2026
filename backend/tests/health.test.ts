import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import { getLiveHealth, getReadyHealth } from '../src/controllers/health.controller.js';
import { db } from '../src/database/postgres.js';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';

describe('Health Endpoints Integration Tests', () => {
  it('GET /health/live should return 200 OK with UP status', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/health/live', getLiveHealth);

    const res = await fetchResponse(app, '/health/live');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('UP');
    expect(res.body.requestId).toBeDefined();
  });

  it('GET /health/ready should return 503 NOT_READY when DB is disconnected', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/health/ready', getReadyHealth);

    vi.spyOn(db, 'isReady').mockResolvedValueOnce(false);

    const res = await fetchResponse(app, '/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(res.body.data.status).toBe('NOT_READY');
  });
});

async function fetchResponse(app: express.Express, path: string) {
  const server = app.listen(0);
  const address = server.address() as any;
  const port = address.port;

  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const json = await res.json();
    return { status: res.status, body: json };
  } finally {
    server.close();
  }
}
