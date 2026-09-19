import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../config/index.js';

export class DatabaseConnectionError extends Error {
  constructor(message: string, public readonly originalError?: Error) {
    super(message);
    this.name = 'DatabaseConnectionError';
  }
}

class PostgresDatabase {
  private pool: Pool | null = null;

  public getPool(): Pool {
    if (!this.pool) {
      this.pool = new Pool({
        host: config.POSTGRES_HOST,
        port: config.POSTGRES_PORT,
        user: config.POSTGRES_USER,
        password: config.POSTGRES_PASSWORD,
        database: config.POSTGRES_DB,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      this.pool.on('error', (err) => {
        console.error('[PostgreSQL Pool Error]', err.message);
      });
    }
    return this.pool;
  }

  public async query<R extends QueryResultRow = any>(
    text: string,
    params: any[] = []
  ): Promise<QueryResult<R>> {
    try {
      const pool = this.getPool();
      return await pool.query<R>(text, params);
    } catch (err: any) {
      throw new DatabaseConnectionError(`Database query failed: ${err.message}`, err);
    }
  }

  public async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = this.getPool();
    let client: PoolClient;
    try {
      client = await pool.connect();
    } catch (err: any) {
      throw new DatabaseConnectionError(`Failed to acquire connection for transaction: ${err.message}`, err);
    }

    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (err: any) {
      await client.query('ROLLBACK').catch(() => {});
      throw err instanceof DatabaseConnectionError
        ? err
        : new DatabaseConnectionError(`Transaction rolled back: ${err.message}`, err);
    } finally {
      client.release();
    }
  }

  public async isReady(): Promise<boolean> {
    try {
      const pool = this.getPool();
      const res = await pool.query('SELECT 1 AS ready');
      return res.rows.length > 0 && Number(res.rows[0].ready) === 1;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }
}

export const db = new PostgresDatabase();
