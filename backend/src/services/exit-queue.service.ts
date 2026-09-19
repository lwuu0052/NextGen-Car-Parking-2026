import { invoiceRepository } from '../repositories/invoice.repository.js';
import { paymentAttemptRepository } from '../repositories/payment-attempt.repository.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { billingService } from './billing.service.js';
import { sessionService } from './session.service.js';

interface ExitQueueItem {
  carPlate: string;
  enqueuedAt: number;
}

export type HeldReason = 'fraud_detected' | 'payment_timeout';

export interface HeldVehicle {
  carPlate: string;
  invoiceId: number | null;
  reason: HeldReason;
  heldAt: number;
}

type ExitProcessResult = 'released' | 'held';

/**
 * Single-lane exit gate (gateB). Cars are physically stuck in arrival order behind
 * a stopped vehicle, so this queue is strictly FIFO and only ever deals with one
 * car at a time: the one currently sitting at the exit sensor.
 *
 * A car is only ever charged ONCE per parking session (the simulator penalizes a
 * second /charge call). If payment does not validate in time, the car is moved to
 * a "held" bucket instead of being auto-retried — gateB stays closed and nothing
 * behind it can move until an operator resolves it (see forceRelease/retryPayment).
 */
export class ExitQueueService {
  private readonly queue: ExitQueueItem[] = [];
  private readonly queuedPlates = new Set<string>();
  private readonly held = new Map<string, HeldVehicle>();
  private readonly chargeSentForSession = new Set<number>();
  private processing = false;
  private readonly releaseGapMs = 1500;
  private readonly paymentTimeoutMs = 15_000;
  private readonly pollIntervalMs = 500;
  private readonly exitGateName = 'gateB';
  private readonly exitSpotName = 'EXIT_EXIT';

  public enqueue(carPlate: string): void {
    if (!carPlate || this.queuedPlates.has(carPlate) || this.held.has(carPlate)) {
      return;
    }

    this.queue.push({ carPlate, enqueuedAt: Date.now() });
    this.queuedPlates.add(carPlate);
    console.log(`[Exit Queue] Enqueued "${carPlate}". Queue length: ${this.queue.length}.`);
    void this.processQueue();
  }

  public getHeldVehicles(): HeldVehicle[] {
    return Array.from(this.held.values());
  }

  public getQueuedPlates(): string[] {
    return this.queue.map((item) => item.carPlate);
  }

  /**
   * Operator override: opens the gate for a held vehicle without a validated payment.
   * This bypasses the anti-evasion check on purpose, so it is logged distinctly for audit.
   */
  public async forceRelease(carPlate: string): Promise<{ success: boolean; message: string }> {
    const heldEntry = this.held.get(carPlate);
    if (!heldEntry) {
      return { success: false, message: `"${carPlate}" is not currently held at the exit.` };
    }

    console.warn(
      `[Exit Queue] OPERATOR OVERRIDE: Force-releasing "${carPlate}" (held reason: ${heldEntry.reason}) without confirmed payment.`
    );
    this.held.delete(carPlate);
    await this.releaseVehicle(carPlate);
    return { success: true, message: `"${carPlate}" released by operator override.` };
  }

  /**
   * Operator action: give a held vehicle another chance to submit a valid payment
   * for the SAME invoice, without re-issuing a new /charge request to the simulator.
   */
  public async retryPayment(carPlate: string): Promise<{ success: boolean; message: string }> {
    const heldEntry = this.held.get(carPlate);
    if (!heldEntry) {
      return { success: false, message: `"${carPlate}" is not currently held at the exit.` };
    }

    this.held.delete(carPlate);
    console.log(`[Exit Queue] Operator requested a payment retry for held vehicle "${carPlate}".`);

    const outcome = await this.waitForPaymentOrFraud(carPlate, heldEntry.invoiceId);
    if (outcome.isPaid) {
      await this.releaseVehicle(carPlate);
      return { success: true, message: `"${carPlate}" paid successfully on retry and was released.` };
    }

    this.putOnHold(carPlate, heldEntry.invoiceId, outcome.reason);
    return { success: false, message: `"${carPlate}" still unresolved (${outcome.reason}); remains held.` };
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        this.queuedPlates.delete(item.carPlate);

        const result = await this.processOne(item);

        if (result === 'released' && this.queue.length > 0) {
          await this.sleep(this.releaseGapMs);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processOne(item: ExitQueueItem): Promise<ExitProcessResult> {
    const carPlate = item.carPlate;
    console.log(`[Exit Queue] Processing "${carPlate}" at front of FIFO queue.`);

    const activeSession = await sessionRepository.findActiveSessionByPlate(carPlate).catch(() => null);
    if (!activeSession) {
      console.warn(`[Exit Queue] No active session found for "${carPlate}". Releasing in FIFO order to clear exit.`);
      return this.releaseVehicle(carPlate);
    }

    if (!['ready_to_exit', 'awaiting_payment'].includes(activeSession.status)) {
      console.log(
        `[Exit Queue] "${carPlate}" reached exit with status "${activeSession.status}". Marking ready for payment.`
      );
      await sessionService.markUnparked(carPlate);
    }

    // Already paid (e.g. a duplicate exit event for a car we already cleared)
    const existingInvoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate).catch(() => null);
    if (existingInvoice?.status === 'paid') {
      console.log(`[Exit Queue] Car "${carPlate}" already paid. Releasing vehicle.`);
      return this.releaseVehicle(carPlate);
    }

    // Request payment exactly once per session — the simulator penalizes a second /charge call.
    let invoiceId = existingInvoice?.id ?? null;
    if (!this.chargeSentForSession.has(activeSession.id)) {
      const charge = await billingService.generateSimulatorChargeInvoice(activeSession);
      invoiceId = charge.invoice.id;
      this.chargeSentForSession.add(activeSession.id);

      const chargeResult = await simulatorClient.chargeCar(carPlate, charge.parkingCost, charge.chargingCost);
      console.log(`[Exit Queue] Charge requested for "${carPlate}" (total: ${charge.totalCost}):`, chargeResult);
    } else {
      console.log(`[Exit Queue] Charge already requested for session #${activeSession.id}; waiting on existing invoice.`);
    }

    const outcome = await this.waitForPaymentOrFraud(carPlate, invoiceId);
    if (outcome.isPaid) {
      console.log(`[Exit Queue] Payment SUCCESS for "${carPlate}". Opening ${this.exitGateName} and releasing.`);
      return this.releaseVehicle(carPlate);
    }

    console.warn(
      `[Exit Queue] "${carPlate}" NOT released (${outcome.reason}). Keeping ${this.exitGateName} CLOSED and holding vehicle; ` +
        `queue behind it stays blocked until an operator resolves it (forceRelease/retryPayment).`
    );
    await simulatorClient.closeGate(this.exitGateName).catch(() => {});
    this.putOnHold(carPlate, invoiceId, outcome.reason);
    return 'held';
  }

  /**
   * Polls up to paymentTimeoutMs for either a valid payment or an explicit invalid
   * payment attempt (fraud signal) recorded against this invoice by billingService's
   * anti-fraud amount check. Returns as soon as either is observed.
   */
  private async waitForPaymentOrFraud(
    carPlate: string,
    invoiceId: number | null
  ): Promise<{ isPaid: boolean; reason: HeldReason }> {
    console.log(`[Exit Queue] Waiting up to ${this.paymentTimeoutMs / 1000}s for "${carPlate}" to complete payment...`);
    const deadline = Date.now() + this.paymentTimeoutMs;

    while (Date.now() < deadline) {
      const invoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate).catch(() => null);
      if (invoice?.status === 'paid') {
        return { isPaid: true, reason: 'payment_timeout' };
      }

      const currentInvoiceId = invoiceId ?? invoice?.id ?? null;
      if (currentInvoiceId) {
        const attempts = await paymentAttemptRepository.findAttemptsByInvoiceId(currentInvoiceId).catch(() => []);
        if (attempts.some((a) => a.verification_status === 'invalid')) {
          console.warn(`[Exit Queue] Fake/invalid payment attempt detected for "${carPlate}". Treating as fare evasion.`);
          return { isPaid: false, reason: 'fraud_detected' };
        }
      }

      await this.sleep(this.pollIntervalMs);
    }

    return { isPaid: false, reason: 'payment_timeout' };
  }

  private putOnHold(carPlate: string, invoiceId: number | null, reason: HeldReason): void {
    this.held.set(carPlate, {
      carPlate,
      invoiceId,
      reason,
      heldAt: Date.now(),
    });
  }

  private async releaseVehicle(carPlate: string, exitCountBefore?: number | null): Promise<ExitProcessResult> {
    const initialCount = exitCountBefore ?? (await this.getExitDetectedCars());

    await simulatorClient.openGate(this.exitGateName).catch(() => {});
    const opened = await simulatorClient.waitForGateState(this.exitGateName, 'Open', 3000);
    if (!opened) {
      console.warn(`[Exit Queue] ${this.exitGateName} did not report Open before dispatching "${carPlate}".`);
    }

    const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1');
    console.log(`[Exit Queue] Dispatch result for "${carPlate}":`, dispatchResult);

    if (dispatchResult.success) {
      setTimeout(async () => {
        await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1').catch(() => {});
      }, 1000);
      await this.waitForExitSpotProgress(initialCount);
      await sessionService.markDeparted(carPlate);

      // Auto-close gate after car has passed through
      setTimeout(() => {
        simulatorClient.closeGate(this.exitGateName).catch(() => {});
      }, 1500);
      return 'released';
    }

    return 'held';
  }

  private async getExitDetectedCars(): Promise<number | null> {
    const spots = await simulatorClient.listParkingSpots().catch(() => []);
    const exitSpot = spots.find((spot: any) => {
      const name = spot.Name || spot.name;
      const purpose = (spot.purpose || spot.Purpose || spot.SpotType || '').toLowerCase();
      return name === this.exitSpotName || purpose.includes('exit');
    }) as any;

    if (!exitSpot) {
      return null;
    }

    const detectedCars =
      exitSpot.detectedCars ??
      exitSpot.DetectedCars ??
      exitSpot.carCount ??
      exitSpot.CarCount ??
      exitSpot.CarsDetected;

    if (typeof detectedCars === 'number') {
      return detectedCars;
    }

    const occupancyStatus = (exitSpot.OccupancyStatus || exitSpot.occupancy_status || '').toLowerCase();
    if (occupancyStatus === 'occupied' || occupancyStatus === 'reserved') {
      return 1;
    }

    if (occupancyStatus === 'free') {
      return 0;
    }

    return null;
  }

  private async waitForExitSpotProgress(initialCount: number | null): Promise<void> {
    if (initialCount === null || initialCount <= 0) {
      await this.sleep(this.releaseGapMs);
      return;
    }

    const deadline = Date.now() + 5000;
    while (Date.now() <= deadline) {
      const currentCount = await this.getExitDetectedCars();
      if (currentCount !== null && currentCount < initialCount) {
        return;
      }

      await this.sleep(250);
    }

    console.warn('[Exit Queue] Exit detector did not decrease before timeout; continuing with next queued vehicle.');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const exitQueueService = new ExitQueueService();
