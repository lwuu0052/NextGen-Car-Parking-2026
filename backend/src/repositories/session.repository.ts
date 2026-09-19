import { db } from '../database/postgres.js';

export type ParkingSessionStatus =
  | 'waiting'
  | 'heading_to_spot'
  | 'parked'
  | 'awaiting_payment'
  | 'ready_to_exit'
  | 'departed'
  | 'cancelled';

export interface ParkingSessionRecord {
  id: number;
  plate_number: string;
  car_type: string;
  parking_spot_id: number | null;
  status: ParkingSessionStatus;
  arrived_at: Date;
  parked_at: Date | null;
  unparked_at: Date | null;
  departed_at: Date | null;
  parking_duration_seconds: number | null;
}

const memorySessions: Map<number, ParkingSessionRecord> = new Map();
let memorySessionIdCounter = 100;

export class SessionRepository {
  public async createSession(data: {
    plate_number: string;
    car_type: string;
    parking_spot_id?: number | null;
    status?: ParkingSessionStatus;
    arrived_at?: Date;
  }): Promise<ParkingSessionRecord> {
    const status = data.status || 'heading_to_spot';
    const arrivedAt = data.arrived_at || new Date();

    try {
      const res = await db.query<ParkingSessionRecord>(
        `INSERT INTO parking_sessions (
           plate_number, car_type, parking_spot_id, status, arrived_at
         )
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          data.plate_number,
          data.car_type,
          data.parking_spot_id ?? null,
          status,
          arrivedAt,
        ]
      );
      const record = res.rows[0];
      if (record) memorySessions.set(record.id, record);
      return record;
    } catch (err: any) {
      console.warn(`[SessionRepository] DB query failed (${err.message}). Using in-memory fallback.`);
      const newRecord: ParkingSessionRecord = {
        id: memorySessionIdCounter++,
        plate_number: data.plate_number,
        car_type: data.car_type,
        parking_spot_id: data.parking_spot_id ?? null,
        status,
        arrived_at: arrivedAt,
        parked_at: null,
        unparked_at: null,
        departed_at: null,
        parking_duration_seconds: null,
      };
      memorySessions.set(newRecord.id, newRecord);
      return newRecord;
    }
  }

  public async findActiveSessionByPlate(plateNumber: string): Promise<ParkingSessionRecord | null> {
    try {
      const res = await db.query<ParkingSessionRecord>(
        `SELECT * FROM parking_sessions 
         WHERE plate_number = $1 
           AND status NOT IN ('departed', 'cancelled')
         ORDER BY arrived_at DESC 
         LIMIT 1`,
        [plateNumber]
      );
      return res.rows[0] || null;
    } catch {
      return (
        Array.from(memorySessions.values()).find(
          (s) => s.plate_number === plateNumber && !['departed', 'cancelled'].includes(s.status)
        ) || null
      );
    }
  }

  public async updateStatus(
    id: number,
    status: ParkingSessionStatus,
    timestamps?: {
      parked_at?: Date;
      unparked_at?: Date;
      departed_at?: Date;
      parking_duration_seconds?: number;
    }
  ): Promise<ParkingSessionRecord | null> {
    const fields: string[] = ['status = $1'];
    const params: any[] = [status, id];

    if (timestamps?.parked_at) {
      params.push(timestamps.parked_at);
      fields.push(`parked_at = $${params.length}`);
    }
    if (timestamps?.unparked_at) {
      params.push(timestamps.unparked_at);
      fields.push(`unparked_at = $${params.length}`);
    }
    if (timestamps?.departed_at) {
      params.push(timestamps.departed_at);
      fields.push(`departed_at = $${params.length}`);
    }
    if (timestamps?.parking_duration_seconds !== undefined) {
      params.push(timestamps.parking_duration_seconds);
      fields.push(`parking_duration_seconds = $${params.length}`);
    }

    try {
      const res = await db.query<ParkingSessionRecord>(
        `UPDATE parking_sessions 
         SET ${fields.join(', ')} 
         WHERE id = $2 
         RETURNING *`,
        params
      );
      const record = res.rows[0];
      if (record) memorySessions.set(record.id, record);
      return record || null;
    } catch {
      const session = memorySessions.get(id);
      if (session) {
        session.status = status;
        if (timestamps?.parked_at) session.parked_at = timestamps.parked_at;
        if (timestamps?.unparked_at) session.unparked_at = timestamps.unparked_at;
        if (timestamps?.departed_at) session.departed_at = timestamps.departed_at;
        if (timestamps?.parking_duration_seconds !== undefined) {
          session.parking_duration_seconds = timestamps.parking_duration_seconds;
        }
      }
      return session || null;
    }
  }

  public async findAllActiveSessions(): Promise<ParkingSessionRecord[]> {
    try {
      const res = await db.query<ParkingSessionRecord>(
        `SELECT * FROM parking_sessions 
         WHERE status NOT IN ('departed', 'cancelled')
         ORDER BY arrived_at DESC`
      );
      return res.rows;
    } catch {
      return Array.from(memorySessions.values()).filter(
        (s) => !['departed', 'cancelled'].includes(s.status)
      );
    }
  }
  public clearAll(): void {
    memorySessions.clear();
    memorySessionIdCounter = 100;
  }
}

export const sessionRepository = new SessionRepository();
