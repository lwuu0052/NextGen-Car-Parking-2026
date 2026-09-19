import { createApp } from './app.js';
import { config } from './config/index.js';
import { logger } from './middleware/logger.middleware.js';
import { db } from './database/postgres.js';

const app = createApp();

const server = app.listen(config.APP_PORT, config.APP_HOST, () => {
  logger.info(
    `[Server] Parking Management Backend started on http://${config.APP_HOST}:${config.APP_PORT} in ${config.APP_ENV} mode`
  );
  logger.info(`[Server] Simulator Base URL configured as ${config.SIMULATOR_BASE_URL}`);
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`[Server] Received ${signal}. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info('[Server] HTTP server closed.');
    try {
      await db.close();
      logger.info('[Server] PostgreSQL connection pool closed.');
    } catch (err) {
      logger.error({ err }, '[Server] Error closing PostgreSQL connection pool');
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
