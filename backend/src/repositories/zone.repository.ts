import { db } from '../database/postgres.js';

export interface ZoneRecord {
  id: number;
  simulator_name: string;
  co_level: number | null;
  updated_at: Date;
}

export class ZoneRepository {
  public async findBySimulatorName(simulatorName: string): Promise<ZoneRecord | null> {
    const res = await db.query<ZoneRecord>(
      'SELECT * FROM zones WHERE simulator_name = $1 LIMIT 1',
      [simulatorName]
    );
    return res.rows[0] || null;
  }

  public async upsertZone(simulatorName: string, coLevel?: number): Promise<ZoneRecord> {
    const res = await db.query<ZoneRecord>(
      `INSERT INTO zones (simulator_name, co_level, updated_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (simulator_name) 
       DO UPDATE SET 
         co_level = COALESCE(EXCLUDED.co_level, zones.co_level),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [simulatorName, coLevel ?? null]
    );
    return res.rows[0];
  }

  public async findAll(): Promise<ZoneRecord[]> {
    const res = await db.query<ZoneRecord>('SELECT * FROM zones ORDER BY id ASC');
    return res.rows;
  }

  public async updateCoLevel(simulatorName: string, coLevel: number): Promise<ZoneRecord | null> {
    const res = await db.query<ZoneRecord>(
      `UPDATE zones 
       SET co_level = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE simulator_name = $2 
       RETURNING *`,
      [coLevel, simulatorName]
    );
    return res.rows[0] || null;
  }
}

export const zoneRepository = new ZoneRepository();
