import { db } from '../database/postgres.js';

export interface ParkingSpotRecord {
  id: number;
  simulator_name: string;
  zone_id: number;
  spot_type: 'any' | 'electric' | 'accessible';
  occupancy_status: 'free' | 'reserved' | 'occupied';
  health_status: 'normal' | 'broken' | 'maintenance';
  usage_count: number;
  updated_at: Date;
}

export class ParkingSpotRepository {
  public async findBySimulatorName(simulatorName: string): Promise<ParkingSpotRecord | null> {
    const res = await db.query<ParkingSpotRecord>(
      'SELECT * FROM parking_spots WHERE simulator_name = $1 LIMIT 1',
      [simulatorName]
    );
    return res.rows[0] || null;
  }

  public async upsertSpot(data: {
    simulator_name: string;
    zone_id: number;
    spot_type?: 'any' | 'electric' | 'accessible';
    occupancy_status?: 'free' | 'reserved' | 'occupied';
    health_status?: 'normal' | 'broken' | 'maintenance';
    usage_count?: number;
  }): Promise<ParkingSpotRecord> {
    const spotType = (data.spot_type || 'any').toLowerCase() as 'any' | 'electric' | 'accessible';
    const occupancyStatus = data.occupancy_status || 'free';
    const healthStatus = data.health_status || 'normal';
    const usageCount = data.usage_count || 0;

    const res = await db.query<ParkingSpotRecord>(
      `INSERT INTO parking_spots (simulator_name, zone_id, spot_type, occupancy_status, health_status, usage_count, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       ON CONFLICT (simulator_name)
       DO UPDATE SET
         zone_id = EXCLUDED.zone_id,
         spot_type = EXCLUDED.spot_type,
         occupancy_status = EXCLUDED.occupancy_status,
         health_status = EXCLUDED.health_status,
         usage_count = EXCLUDED.usage_count,
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [data.simulator_name, data.zone_id, spotType, occupancyStatus, healthStatus, usageCount]
    );
    return res.rows[0];
  }

  public async findAll(): Promise<ParkingSpotRecord[]> {
    const res = await db.query<ParkingSpotRecord>(
      'SELECT * FROM parking_spots ORDER BY id ASC'
    );
    return res.rows;
  }

  public async updateStatuses(
    simulatorName: string,
    updates: {
      occupancy_status?: 'free' | 'reserved' | 'occupied';
      health_status?: 'normal' | 'broken' | 'maintenance';
      usage_count?: number;
    }
  ): Promise<ParkingSpotRecord | null> {
    const fields: string[] = ['updated_at = CURRENT_TIMESTAMP'];
    const params: any[] = [simulatorName];

    if (updates.occupancy_status) {
      params.push(updates.occupancy_status);
      fields.push(`occupancy_status = $${params.length}`);
    }
    if (updates.health_status) {
      params.push(updates.health_status);
      fields.push(`health_status = $${params.length}`);
    }
    if (updates.usage_count !== undefined) {
      params.push(updates.usage_count);
      fields.push(`usage_count = $${params.length}`);
    }

    const res = await db.query<ParkingSpotRecord>(
      `UPDATE parking_spots 
       SET ${fields.join(', ')} 
       WHERE simulator_name = $1 
       RETURNING *`,
      params
    );
    return res.rows[0] || null;
  }
}

export const parkingSpotRepository = new ParkingSpotRepository();
