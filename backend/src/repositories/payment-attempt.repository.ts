import { db } from '../database/postgres.js';

export type PaymentVerificationStatus = 'pending' | 'valid' | 'invalid';

export interface PaymentAttemptRecord {
  id: number;
  invoice_id: number;
  external_payment_id: string | null;
  reported_amount_minor: number;
  verification_status: PaymentVerificationStatus;
  received_at: Date;
  verified_at: Date | null;
}

const memoryAttempts: Map<number, PaymentAttemptRecord> = new Map();
let memoryAttemptIdCounter = 1;

export class PaymentAttemptRepository {
  public async createAttempt(data: {
    invoice_id: number;
    external_payment_id?: string | null;
    reported_amount_minor: number;
    verification_status?: PaymentVerificationStatus;
  }, client?: any): Promise<PaymentAttemptRecord> {
    const status = data.verification_status || 'pending';
    const now = new Date();
    const verifiedAt = status !== 'pending' ? now : null;
    const externalId = data.external_payment_id || null;

    try {
      const queryRunner = client || db;
      const res = await queryRunner.query(
        `INSERT INTO payment_attempts (
           invoice_id, external_payment_id, reported_amount_minor, verification_status, received_at, verified_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [data.invoice_id, externalId, data.reported_amount_minor, status, now, verifiedAt]
      );
      const record = res.rows[0];
      memoryAttempts.set(record.id, record);
      return record;
    } catch (err: any) {
      console.warn(`[PaymentAttemptRepository] Database write skipped (${err.message}). Using in-memory store.`);
      const newRecord: PaymentAttemptRecord = {
        id: memoryAttemptIdCounter++,
        invoice_id: data.invoice_id,
        external_payment_id: externalId,
        reported_amount_minor: data.reported_amount_minor,
        verification_status: status,
        received_at: now,
        verified_at: verifiedAt,
      };
      memoryAttempts.set(newRecord.id, newRecord);
      return newRecord;
    }
  }

  public async findAttemptByExternalId(externalId: string): Promise<PaymentAttemptRecord | null> {
    if (!externalId) return null;
    try {
      const res = await db.query<PaymentAttemptRecord>(
        `SELECT * FROM payment_attempts WHERE external_payment_id = $1 LIMIT 1`,
        [externalId]
      );
      return res.rows[0] || null;
    } catch {
      return Array.from(memoryAttempts.values()).find((att) => att.external_payment_id === externalId) || null;
    }
  }

  public async findAllAttempts(): Promise<PaymentAttemptRecord[]> {
    try {
      const res = await db.query<PaymentAttemptRecord>(
        `SELECT * FROM payment_attempts ORDER BY received_at DESC`
      );
      return res.rows;
    } catch {
      return Array.from(memoryAttempts.values());
    }
  }
  public clearAll(): void {
    memoryAttempts.clear();
    memoryAttemptIdCounter = 1;
  }
}

export const paymentAttemptRepository = new PaymentAttemptRepository();
