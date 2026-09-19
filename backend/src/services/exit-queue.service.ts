import { invoiceRepository } from '../repositories/invoice.repository.js';
import { sessionRepository, ParkingSessionRecord } from '../repositories/session.repository.js';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { billingService } from './billing.service.js';
import { sessionService } from './session.service.js';

interface ExitQueueItem {
  carPlate: string;
  enqueuedAt: number;
  attempts: number;
}

type ExitProcessResult = 'released' | 'retry';

export class ExitQueueService {
  private readonly queue: ExitQueueItem[] = [];
  private readonly queuedPlates = new Set<string>();
  private processing = false;
  private readonly releaseGapMs = 1500;
  private readonly retryDelayMs = 800;
  private readonly exitSpotName = 'EXIT_EXIT';

  public enqueue(carPlate: string): void {
    if (!carPlate || this.queuedPlates.has(carPlate)) {
      return;
    }

    this.queue.push({ carPlate, enqueuedAt: Date.now(), attempts: 0 });
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
        item.attempts += 1;

        const result = await this.processOne(item);
        if (result === 'retry') {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
          continue;
        }

        this.queue.shift();
        this.queuedPlates.delete(item.carPlate);

        if (result === 'released' && this.queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, this.releaseGapMs));
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processOne(item: ExitQueueItem): Promise<ExitProcessResult> {
    const carPlate = item.carPlate;
    console.log(`[Exit Queue] Processing "${carPlate}" at front of queue.`);

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

    const exitCountBefore = await this.getExitDetectedCars();
    const paid = await this.ensurePaid(carPlate, activeSession);
    if (!paid) {
      console.warn(`[Exit Queue] Payment clearance failed for "${carPlate}". Will retry while it remains queue head.`);
      return 'retry';
    }

    return this.releaseVehicle(carPlate, exitCountBefore);
  }

  private async releaseVehicle(carPlate: string, exitCountBefore?: number | null): Promise<ExitProcessResult> {
    const initialCount = exitCountBefore ?? (await this.getExitDetectedCars());

    await simulatorClient.openGate('gateB').catch(() => {});
    const opened = await simulatorClient.waitForGateState('gateB', 'Open', 3000);
    if (!opened) {
      console.warn(`[Exit Queue] gateB did not report Open before dispatching "${carPlate}".`);
    }

    const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'leavepark');
    console.log(`[Exit Queue] Dispatch result for "${carPlate}":`, dispatchResult);

    if (dispatchResult.success) {
      setTimeout(async () => {
        await simulatorClient.sendCarToSpot(carPlate, 'leavepark').catch(() => {});
      }, 1000);
      await this.waitForExitSpotProgress(initialCount);
      await sessionService.markDeparted(carPlate);
      return 'released';
    }

    return 'retry';
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
      await new Promise((resolve) => setTimeout(resolve, this.releaseGapMs));
      return;
    }

    const deadline = Date.now() + 5000;
    while (Date.now() <= deadline) {
      const currentCount = await this.getExitDetectedCars();
      if (currentCount !== null && currentCount < initialCount) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    console.warn('[Exit Queue] Exit detector did not decrease before timeout; continuing with next queued vehicle.');
  }
}

export const exitQueueService = new ExitQueueService();
