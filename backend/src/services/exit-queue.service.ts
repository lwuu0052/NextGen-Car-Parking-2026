import { invoiceRepository } from '../repositories/invoice.repository.js';
import { sessionRepository, ParkingSessionRecord } from '../repositories/session.repository.js';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { billingService } from './billing.service.js';
import { sessionService } from './session.service.js';


interface ExitQueueItem {
  carPlate: string;
  enqueuedAt: number;
}

export class ExitQueueService {
  private readonly queue: ExitQueueItem[] = [];
  private readonly queuedPlates = new Set<string>();
  private processing = false;
  private readonly releaseGapMs = 1800;

  public enqueue(carPlate: string): void {
    if (!carPlate || this.queuedPlates.has(carPlate)) {
      return;
    }

    this.queue.push({ carPlate, enqueuedAt: Date.now() });
    this.queuedPlates.add(carPlate);
    console.log(`[Exit Queue] Enqueued "${carPlate}". Queue length: ${this.queue.length}.`);
    void this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        await this.processOne(item.carPlate);
        this.queue.shift();
        this.queuedPlates.delete(item.carPlate);

        if (this.queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.releaseGapMs));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processOne(carPlate: string): Promise<void> {
    console.log(`[Exit Queue] Processing "${carPlate}" at front of queue.`);

    const activeSession = await sessionRepository.findActiveSessionByPlate(carPlate).catch(() => null);
    if (!activeSession) {
      console.warn(`[Exit Queue] No active session found for "${carPlate}". Skipping.`);
      return;
    }

    if (!['ready_to_exit', 'awaiting_payment'].includes(activeSession.status)) {
      console.log(`[Exit Queue] "${carPlate}" status is "${activeSession.status}", not ready for exit.`);
      return;
    }

    const paid = await this.ensurePaid(carPlate, activeSession);
    if (!paid) {
      console.warn(`[Exit Queue] Payment clearance failed for "${carPlate}". Keeping car at exit.`);
      return;
    }

    await simulatorClient.openGate('gateB').catch(() => {});
    const opened = await simulatorClient.waitForGateState('gateB', 'Open', 3000);
    if (!opened) {
      console.warn(`[Exit Queue] gateB did not report Open before dispatching "${carPlate}".`);
    }

    const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'leavepark');
    console.log(`[Exit Queue] Dispatch result for "${carPlate}":`, dispatchResult);

    if (dispatchResult.success) {
      await sessionService.markDeparted(carPlate);
      setTimeout(async () => {
        await simulatorClient.sendCarToSpot(carPlate, 'leavepark').catch(() => {});
      }, 1000);
    }
  }

  private async ensurePaid(carPlate: string, session: ParkingSessionRecord): Promise<boolean> {
    const existingInvoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate).catch(() => null);
    if (existingInvoice?.status === 'paid') {
      return true;
    }

    if (session.status === 'awaiting_payment') {
      const result = await billingService.processPaymentEvent(
        {
          EventClass: 'payment_made',
          CarPlateNumber: carPlate,
          Amount: Number.MAX_SAFE_INTEGER,
          EventId: `exit_queue_clear_${Date.now()}_${carPlate.replace(/\s+/g, '')}`,
        },
        { dispatchOnSuccess: false }
      );
      return result.success;
    }

    const charge = await billingService.generateSimulatorChargeInvoice(session);
    const chargeResult = await simulatorClient.chargeCar(carPlate, charge.parkingCost, charge.chargingCost);
    console.log(`[Exit Queue] Charge result for "${carPlate}":`, chargeResult);
    if (!chargeResult.success) {
      return false;
    }

    const paymentResult = await billingService.processPaymentEvent(
      {
        EventClass: 'payment_made',
        CarPlateNumber: carPlate,
        Amount: charge.totalCost,
        EventId: `exit_queue_pay_${Date.now()}_${carPlate.replace(/\s+/g, '')}`,
      },
      { dispatchOnSuccess: false }
    );

    return paymentResult.success;
  }
}

export const exitQueueService = new ExitQueueService();
