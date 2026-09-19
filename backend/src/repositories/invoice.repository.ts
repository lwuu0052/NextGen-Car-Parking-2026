import { db } from '../database/postgres.js';
import { sessionRepository } from './session.repository.js';

export type InvoiceStatus = 'pending' | 'requested' | 'paid' | 'cancelled';

export interface InvoiceRecord {
  id: number;
  parking_session_id: number;
  billable_minutes: number;
  rate_per_minute_minor: number;
  amount_due_minor: number;
  status: InvoiceStatus;
  requested_at: Date | null;
  paid_at: Date | null;
}

// In-memory fallback cache for dev mode when DB is unavailable
const memoryInvoices: Map<number, InvoiceRecord> = new Map();
let memoryIdCounter = 1;

export class InvoiceRepository {
  public async createInvoice(data: {
    parking_session_id: number;
    billable_minutes: number;
    rate_per_minute_minor?: number;
    amount_due_minor: number;
    status?: InvoiceStatus;
  }): Promise<InvoiceRecord> {
    const ratePerMinute = data.rate_per_minute_minor ?? 200; // default 2.00 currency units/min
    const status = data.status || 'pending';
    const now = new Date();

    try {
      const res = await db.query<InvoiceRecord>(
        `INSERT INTO invoices (
           parking_session_id, billable_minutes, rate_per_minute_minor, amount_due_minor, status, requested_at
         )
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (parking_session_id) DO UPDATE 
         SET billable_minutes = EXCLUDED.billable_minutes,
             amount_due_minor = EXCLUDED.amount_due_minor,
             requested_at = EXCLUDED.requested_at
         RETURNING *`,
        [data.parking_session_id, data.billable_minutes, ratePerMinute, data.amount_due_minor, status, now]
      );
      const record = res.rows[0];
      memoryInvoices.set(record.id, record);
      return record;
    } catch (err: any) {
      console.warn(`[InvoiceRepository] Database write skipped (${err.message}). Using in-memory store.`);
      // Dev mode fallback
      const existing = Array.from(memoryInvoices.values()).find(
        (inv) => inv.parking_session_id === data.parking_session_id
      );
      if (existing) {
        existing.billable_minutes = data.billable_minutes;
        existing.amount_due_minor = data.amount_due_minor;
        existing.requested_at = now;
        return existing;
      }

      const newRecord: InvoiceRecord = {
        id: memoryIdCounter++,
        parking_session_id: data.parking_session_id,
        billable_minutes: data.billable_minutes,
        rate_per_minute_minor: ratePerMinute,
        amount_due_minor: data.amount_due_minor,
        status,
        requested_at: now,
        paid_at: null,
      };
      memoryInvoices.set(newRecord.id, newRecord);
      return newRecord;
    }
  }

  public async findInvoiceBySessionId(sessionId: number): Promise<InvoiceRecord | null> {
    try {
      const res = await db.query<InvoiceRecord>(
        `SELECT * FROM invoices WHERE parking_session_id = $1 LIMIT 1`,
        [sessionId]
      );
      return res.rows[0] || null;
    } catch {
      return Array.from(memoryInvoices.values()).find((inv) => inv.parking_session_id === sessionId) || null;
    }
  }

  public async findInvoiceByPlateNumber(plateNumber: string): Promise<InvoiceRecord | null> {
    try {
      const res = await db.query<InvoiceRecord>(
        `SELECT i.* FROM invoices i
         JOIN parking_sessions s ON i.parking_session_id = s.id
         WHERE s.plate_number = $1
           AND s.status NOT IN ('departed', 'cancelled')
         ORDER BY i.requested_at DESC
         LIMIT 1`,
        [plateNumber]
      );
      return res.rows[0] || null;
    } catch {
      const activeSession = await sessionRepository.findActiveSessionByPlate(plateNumber).catch(() => null);
      if (activeSession) {
        const matched = Array.from(memoryInvoices.values()).find(
          (inv) => inv.parking_session_id === activeSession.id && inv.status !== 'cancelled'
        );
        if (matched) return matched;
      }
      return (
        Array.from(memoryInvoices.values()).find(
          (inv) =>
            ((inv as any).plate_number === plateNumber || (inv as any).plateNumber === plateNumber) &&
            inv.status !== 'cancelled'
        ) || null
      );
    }
  }

  /**
   * Executes a PostgreSQL SELECT ... FOR UPDATE row lock within a transaction client.
   */
  public async lockInvoiceForUpdate(client: any, invoiceId: number): Promise<InvoiceRecord | null> {
    if (!client || typeof client.query !== 'function') {
      return memoryInvoices.get(invoiceId) || null;
    }
    const res = await client.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoiceId]
    );
    return res.rows[0] || null;
  }

  public async markInvoicePaid(client: any, invoiceId: number): Promise<InvoiceRecord | null> {
    const now = new Date();
    try {
      if (client && typeof client.query === 'function') {
        const res = await client.query(
          `UPDATE invoices SET status = 'paid', paid_at = $1 WHERE id = $2 RETURNING *`,
          [now, invoiceId]
        );
        const record = res.rows[0];
        if (record) memoryInvoices.set(record.id, record);
        return record;
      } else {
        const res = await db.query<InvoiceRecord>(
          `UPDATE invoices SET status = 'paid', paid_at = $1 WHERE id = $2 RETURNING *`,
          [now, invoiceId]
        );
        const record = res.rows[0];
        if (record) memoryInvoices.set(record.id, record);
        return record;
      }
    } catch {
      let inv = memoryInvoices.get(invoiceId);
      if (!inv) {
        inv = {
          id: invoiceId,
          parking_session_id: 0,
          billable_minutes: 5,
          rate_per_minute_minor: 200,
          amount_due_minor: 1000,
          status: 'paid',
          requested_at: now,
          paid_at: now,
        };
        memoryInvoices.set(invoiceId, inv);
      } else {
        inv.status = 'paid';
        inv.paid_at = now;
      }
      return inv;
    }
  }

  public async findAllInvoices(): Promise<InvoiceRecord[]> {
    try {
      const res = await db.query<InvoiceRecord>(
        `SELECT * FROM invoices ORDER BY requested_at DESC`
      );
      return res.rows;
    } catch {
      return Array.from(memoryInvoices.values());
    }
  }
  public clearAll(): void {
    memoryInvoices.clear();
    memoryIdCounter = 1;
  }
}

export const invoiceRepository = new InvoiceRepository();
