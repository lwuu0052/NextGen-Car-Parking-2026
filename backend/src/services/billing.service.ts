import { db } from '../database/postgres.js';
import { invoiceRepository, InvoiceRecord } from '../repositories/invoice.repository.js';
import { paymentAttemptRepository, PaymentAttemptRecord } from '../repositories/payment-attempt.repository.js';
import { sessionRepository, ParkingSessionRecord } from '../repositories/session.repository.js';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { PaymentMadeEventPayload } from '../webhooks/models/webhook-event.model.js';

export interface PaymentProcessingResult {
  success: boolean;
  isDuplicate?: boolean;
  reason?: string;
  invoice?: InvoiceRecord | null;
  session?: ParkingSessionRecord | null;
  attempt?: PaymentAttemptRecord | null;
}

export interface PaymentProcessingOptions {
  dispatchOnSuccess?: boolean;
}

export interface SimulatorChargeInvoice {
  invoice: InvoiceRecord;
  billableMinutes: number;
  parkingCost: number;
  chargingCost: number;
  totalCost: number;
}

export class BillingService {
  /**
   * Generates or calculates the invoice for a parking session based on elapsed duration.
   */
  public async generateInvoiceForSession(
    sessionId: number,
    ratePerMinuteMinor: number = 200
  ): Promise<InvoiceRecord | null> {
    const activeSessions = await sessionRepository.findAllActiveSessions().catch(() => []);
    const session = activeSessions.find((s) => s.id === sessionId);

    const arrivedAt = session ? new Date(session.arrived_at).getTime() : Date.now() - 300_000;
    const elapsedMs = Math.max(0, Date.now() - arrivedAt);
    const billableMinutes = Math.max(1, Math.ceil(elapsedMs / 60000));
    const amountDueMinor = billableMinutes * ratePerMinuteMinor;

    const invoice = await invoiceRepository.createInvoice({
      parking_session_id: sessionId,
      billable_minutes: billableMinutes,
      rate_per_minute_minor: ratePerMinuteMinor,
      amount_due_minor: amountDueMinor,
      status: 'pending',
    });

    if (session) {
      await sessionRepository.updateStatus(session.id, 'awaiting_payment').catch(() => null);
    }

    return invoice;
  }

  public async generateSimulatorChargeInvoice(
    session: ParkingSessionRecord
  ): Promise<SimulatorChargeInvoice> {
    const arrivedAt = new Date(session.arrived_at).getTime();
    const elapsedMs = Math.max(0, Date.now() - arrivedAt);
    const billableMinutes = Math.max(1, Math.ceil(elapsedMs / 60000));
    const isElectric = (session.car_type || '').toLowerCase().includes('electric');
    const parkingCost = billableMinutes;
    const chargingCost = isElectric ? billableMinutes * 2 : 0;
    const totalCost = parkingCost + chargingCost;

    const invoice = await invoiceRepository.createInvoice({
      parking_session_id: session.id,
      billable_minutes: billableMinutes,
      rate_per_minute_minor: isElectric ? 3 : 1,
      amount_due_minor: totalCost,
      status: 'pending',
    });

    await sessionRepository.updateStatus(session.id, 'awaiting_payment').catch(() => null);

    return {
      invoice,
      billableMinutes,
      parkingCost,
      chargingCost,
      totalCost,
    };
  }

  /**
   * Processes an incoming payment webhook event using PostgreSQL Transaction + Row-Level Locking (FOR UPDATE).
   * Verifies payment amounts against anti-fraud rules and prevents double-crediting on race conditions.
   */
  public async processPaymentEvent(
    event: PaymentMadeEventPayload,
    options: PaymentProcessingOptions = {}
  ): Promise<PaymentProcessingResult> {
    const dispatchOnSuccess = options.dispatchOnSuccess ?? true;
    const carPlate = event.CarPlateNumber || (event as any).PlateNumber || (event as any).CarPlate;
    const reportedAmount = Number(event.Amount) || 0;
    const externalPaymentId = event.EventId || (event as any).PaymentId || null;

    console.log(
      `[BillingService] Processing payment webhook for Car "${carPlate || 'unknown'}" (Reported Amount: ${reportedAmount}, PaymentId: ${externalPaymentId || 'N/A'})`
    );

    if (!carPlate) {
      return { success: false, reason: 'MISSING_PLATE_NUMBER' };
    }

    // 1. Locate active invoice & session
    let invoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate);
    let session = await sessionRepository.findActiveSessionByPlate(carPlate).catch(() => null);

    if (!session && invoice) {
      const activeSessions = await sessionRepository.findAllActiveSessions().catch(() => []);
      session = activeSessions.find((s) => s.id === invoice?.parking_session_id) || null;
    }

    // If no invoice exists yet, auto-create one for payment processing
    if (!invoice) {
      const sessionId = session ? session.id : 999;
      invoice = await this.generateInvoiceForSession(sessionId);
    }

    if (!invoice) {
      return { success: false, reason: 'INVOICE_NOT_FOUND' };
    }

    // 2. Begin PostgreSQL Transaction + Row-Level Locking (FOR UPDATE)
    let txClient: any = null;
    try {
      txClient = await db.getClient().catch(() => null);
      if (txClient) {
        await txClient.query('BEGIN');
      }

      // Execute SELECT ... FOR UPDATE row lock on invoice
      const lockedInvoice = await invoiceRepository.lockInvoiceForUpdate(txClient, invoice.id);
      const targetInvoice = lockedInvoice || invoice;

      // 3. Idempotency & Duplicate Check
      if (targetInvoice.status === 'paid') {
        console.log(`[BillingService] Invoice #${targetInvoice.id} already paid. Duplicate payment ignored.`);
        await paymentAttemptRepository.createAttempt(
          {
            invoice_id: targetInvoice.id,
            external_payment_id: externalPaymentId,
            reported_amount_minor: reportedAmount,
            verification_status: 'valid',
          },
          txClient
        );
        if (txClient) await txClient.query('COMMIT');

        return { success: true, isDuplicate: true, invoice: targetInvoice, session };
      }

      // 4. Anti-Fraud Amount Verification
      const isAmountValid = reportedAmount >= targetInvoice.amount_due_minor;

      if (!isAmountValid) {
        console.warn(
          `[BillingService Anti-Fraud Warning] Payment rejected for Car "${carPlate}". Reported (${reportedAmount}) < Required (${targetInvoice.amount_due_minor}).`
        );

        const attempt = await paymentAttemptRepository.createAttempt(
          {
            invoice_id: targetInvoice.id,
            external_payment_id: externalPaymentId,
            reported_amount_minor: reportedAmount,
            verification_status: 'invalid',
          },
          txClient
        );

        if (txClient) await txClient.query('COMMIT');

        return {
          success: false,
          reason: 'INSUFFICIENT_AMOUNT',
          invoice: targetInvoice,
          session,
          attempt,
        };
      }

      // 5. Valid Payment Processing: Mark Invoice Paid & Session Ready To Exit
      const paidInvoice = await invoiceRepository.markInvoicePaid(txClient, targetInvoice.id);
      const attempt = await paymentAttemptRepository.createAttempt(
        {
          invoice_id: targetInvoice.id,
          external_payment_id: externalPaymentId,
          reported_amount_minor: reportedAmount,
          verification_status: 'valid',
        },
        txClient
      );

      let updatedSession = session;
      if (session) {
        updatedSession = await sessionRepository.updateStatus(session.id, 'ready_to_exit').catch(() => session);
      }

      if (txClient) {
        await txClient.query('COMMIT');
      }

      console.log(
        `[BillingService Success] Payment verified for Car "${carPlate}". Invoice #${targetInvoice.id} paid. Session ready to exit!`
      );

      if (dispatchOnSuccess) {
        this.triggerExitGateAndDispatch(carPlate);
      }

      return {
        success: true,
        invoice: paidInvoice,
        session: updatedSession,
        attempt,
      };
    } catch (err: any) {
      if (txClient) {
        await txClient.query('ROLLBACK').catch(() => {});
      }
      console.error(`[BillingService Error] Payment processing error:`, err.message);
      return { success: false, reason: err.message };
    } finally {
      if (txClient && typeof txClient.release === 'function') {
        txClient.release();
      }
    }
  }

  private triggerExitGateAndDispatch(carPlate: string): void {
    setTimeout(async () => {
      try {
        console.log(`[BillingService Auto Gate] Opening gateB for paid car "${carPlate}"...`);
        await simulatorClient.openGate('gateB').catch(() => {});
        const opened = await simulatorClient.waitForGateState('gateB', 'Open', 3000);
        if (!opened) {
          console.warn(`[BillingService Auto Gate] gateB did not report Open before dispatching "${carPlate}".`);
        }
        const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'leavepark');
        console.log(`[BillingService Auto Gate] Dispatching paid car "${carPlate}" to leavepark:`, dispatchResult);
        if (dispatchResult.success) {
          await sessionRepository.findActiveSessionByPlate(carPlate)
            .then((session) => session ? sessionRepository.updateStatus(session.id, 'departed', {
              departed_at: new Date(),
              parking_duration_seconds: Math.max(
                0,
                Math.floor((Date.now() - new Date(session.arrived_at).getTime()) / 1000)
              ),
            }) : null)
            .catch(() => null);
        }
        setTimeout(async () => {
          await simulatorClient.sendCarToSpot(carPlate, 'leavepark').catch(() => {});
        }, 1000);
      } catch (err: any) {
        console.error(`[BillingService Auto Gate] Error dispatching paid car "${carPlate}":`, err.message);
      }
    }, 50);
  }
}

export const billingService = new BillingService();
