import { db } from '../database/postgres.js';

export interface DeviceRecord {
  id: number;
  simulator_name: string;
  device_type: 'gate' | 'light' | 'fan' | 'entry_sensor' | 'exit_sensor';
  zone_id: number | null;
  group_name: string | null;
  operating_state: string | null;
  health_status: 'normal' | 'broken' | 'maintenance';
  usage_count: number | null;
  runtime_seconds: number | null;
  updated_at: Date;
}

export class DeviceRepository {
  public async findBySimulatorName(simulatorName: string): Promise<DeviceRecord | null> {
    const res = await db.query<DeviceRecord>(
      'SELECT * FROM devices WHERE simulator_name = $1 LIMIT 1',
      [simulatorName]
    );
    return res.rows[0] || null;
  }

  public async upsertDevice(data: {
    simulator_name: string;
    device_type: 'gate' | 'light' | 'fan' | 'entry_sensor' | 'exit_sensor';
    zone_id?: number | null;
    group_name?: string | null;
    operating_state?: string | null;
    health_status?: 'normal' | 'broken' | 'maintenance';
    usage_count?: number | null;
    runtime_seconds?: number | null;
  }): Promise<DeviceRecord> {
    const res = await db.query<DeviceRecord>(
      `INSERT INTO devices (
         simulator_name, device_type, zone_id, group_name, 
         operating_state, health_status, usage_count, runtime_seconds, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (simulator_name)
       DO UPDATE SET
         device_type = EXCLUDED.device_type,
         zone_id = COALESCE(EXCLUDED.zone_id, devices.zone_id),
         group_name = COALESCE(EXCLUDED.group_name, devices.group_name),
         operating_state = COALESCE(EXCLUDED.operating_state, devices.operating_state),
         health_status = COALESCE(EXCLUDED.health_status, devices.health_status),
         usage_count = COALESCE(EXCLUDED.usage_count, devices.usage_count),
         runtime_seconds = COALESCE(EXCLUDED.runtime_seconds, devices.runtime_seconds),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        data.simulator_name,
        data.device_type,
        data.zone_id ?? null,
        data.group_name ?? null,
        data.operating_state ?? null,
        data.health_status || 'normal',
        data.usage_count ?? null,
        data.runtime_seconds ?? null,
      ]
    );
    return res.rows[0];
  }

  public async findAll(): Promise<DeviceRecord[]> {
    const res = await db.query<DeviceRecord>(
      'SELECT * FROM devices ORDER BY id ASC'
    );
    return res.rows;
  }

  public async updateState(
    simulatorName: string,
    updates: {
      operating_state?: string;
      health_status?: 'normal' | 'broken' | 'maintenance';
      usage_count?: number;
    }
  ): Promise<DeviceRecord | null> {
    const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [simulatorName];

    if (updates.operating_state !== undefined) {
      params.push(updates.operating_state);
      fields.push(`operating_state = $${params.length}`);
    }
    if (updates.health_status !== undefined) {
      params.push(updates.health_status);
      fields.push(`health_status = $${params.length}`);
    }
    if (updates.usage_count !== undefined) {
      params.push(updates.usage_count);
      fields.push(`usage_count = $${params.length}`);
    }

    const res = await db.query<DeviceRecord>(
      `UPDATE devices 
       SET ${fields.join(', ')} 
       WHERE simulator_name = $1 
       RETURNING *`,
      params
    );
    return res.rows[0] || null;
  }
}

export const deviceRepository = new DeviceRepository();
