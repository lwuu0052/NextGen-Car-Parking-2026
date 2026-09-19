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

    // Check if already paid
    let existingInvoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate).catch(() => null);
    if (existingInvoice?.status === 'paid') {
      console.log(`[Exit Queue] Car "${carPlate}" already paid. Releasing vehicle.`);
      return this.releaseVehicle(carPlate);
    }

    // Generate charge and issue simulator charge request
    const charge = await billingService.generateSimulatorChargeInvoice(activeSession);
    const chargeResult = await simulatorClient.chargeCar(carPlate, charge.parkingCost, charge.chargingCost);
    console.log(`[Exit Queue] Charge requested for "${carPlate}" (total: ${charge.totalCost}):`, chargeResult);

    // Wait up to 15 seconds for driver / simulator to complete payment via real payment_made webhook
    const paymentTimeoutMs = 15_000;
    const startTime = Date.now();
    let isPaid = false;

    console.log(`[Exit Queue] Waiting up to 15s for "${carPlate}" to complete payment...`);
    while (Date.now() - startTime < paymentTimeoutMs) {
      existingInvoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate).catch(() => null);
      if (existingInvoice?.status === 'paid') {
        isPaid = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (isPaid) {
      console.log(`[Exit Queue] Payment SUCCESS for "${carPlate}" within 15s. Opening gateB and releasing.`);
      return this.releaseVehicle(carPlate);
    } else {
      console.warn(
        `[Exit Queue] Payment FAILED / TIMED OUT (15s elapsed) for "${carPlate}". Keeping gateB CLOSED. Vehicle remains stopped.`
      );
      // Ensure gateB is explicitly kept closed so unpaid / fraud cars cannot exit!
      await simulatorClient.closeGate('gateB').catch(() => {});
      return 'retry';
    }
  }

  private async releaseVehicle(carPlate: string, exitCountBefore?: number | null): Promise<ExitProcessResult> {
    const initialCount = exitCountBefore ?? (await this.getExitDetectedCars());

    await simulatorClient.openGate('gateB').catch(() => {});
    const opened = await simulatorClient.waitForGateState('gateB', 'Open', 3000);
    if (!opened) {
      console.warn(`[Exit Queue] gateB did not report Open before dispatching "${carPlate}".`);
    }

    const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1');
    console.log(`[Exit Queue] Dispatch result for "${carPlate}":`, dispatchResult);

    if (dispatchResult.success) {
      setTimeout(async () => {
        await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1').catch(() => {});
      }, 1000);
      await this.waitForExitSpotProgress(initialCount);
      await sessionService.markDeparted(carPlate);
      
      // Auto-close gateB after car has passed through
      setTimeout(() => {
        simulatorClient.closeGate('gateB').catch(() => {});
      }, 1500);
      return 'released';
    }

    return 'retry';
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
