import { db } from '../database/postgres.js';

export interface WebhookEventRecord {
  id: number;
  external_event_id: string | null;
  event_type: string;
  payload: Record<string, any>;
  occurred_at: Date | null;
  received_at: Date;
  processing_status: 'pending' | 'processed' | 'failed';
  processed_at: Date | null;
  error_message: string | null;
}

export class WebhookEventRepository {
  public async createEvent(data: {
    external_event_id?: string | null;
    event_type: string;
    payload: Record<string, any>;
    occurred_at?: Date | null;
  }): Promise<{ record: WebhookEventRecord; isDuplicate: boolean }> {
    try {
      const res = await db.query<WebhookEventRecord>(
        `INSERT INTO webhook_events (
           external_event_id, event_type, payload, occurred_at, received_at, processing_status
         )
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'pending')
         ON CONFLICT (external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING
         RETURNING *`,
        [
          data.external_event_id ?? null,
          data.event_type,
          JSON.stringify(data.payload),
          data.occurred_at ?? null,
        ]
      );

      if (res.rows.length === 0) {
        // Duplicate event ignored via ON CONFLICT
        const existing = await this.findByExternalEventId(data.external_event_id!);
        return { record: existing!, isDuplicate: true };
      }

      return { record: res.rows[0], isDuplicate: false };
    } catch (err: any) {
      throw err;
    }
  }

  public async findByExternalEventId(externalEventId: string): Promise<WebhookEventRecord | null> {
    const res = await db.query<WebhookEventRecord>(
      'SELECT * FROM webhook_events WHERE external_event_id = $1 LIMIT 1',
      [externalEventId]
    );
    return res.rows[0] || null;
  }

  public async updateStatus(
    id: number,
    status: 'processed' | 'failed',
    errorMessage?: string
  ): Promise<WebhookEventRecord> {
    const res = await db.query<WebhookEventRecord>(
      `UPDATE webhook_events 
       SET processing_status = $1,
           processed_at = CURRENT_TIMESTAMP,
           error_message = $2
       WHERE id = $3
       RETURNING *`,
      [status, errorMessage || null, id]
    );
    return res.rows[0];
  }

  public async findPendingEvents(): Promise<WebhookEventRecord[]> {
    const res = await db.query<WebhookEventRecord>(
      `SELECT * FROM webhook_events 
       WHERE processing_status = 'pending' 
       ORDER BY received_at ASC`
    );
    return res.rows;
  }
}

export const webhookEventRepository = new WebhookEventRepository();
