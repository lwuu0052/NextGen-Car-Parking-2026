import { CarSpotActionEventPayload } from '../models/webhook-event.model.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';
import { sessionRepository } from '../../repositories/session.repository.js';
import { invoiceRepository } from '../../repositories/invoice.repository.js';
import { simulatorClient } from '../../simulator/client/simulator-client.js';
import { allocationService } from '../../services/allocation.service.js';
import { sessionService } from '../../services/session.service.js';
import { billingService } from '../../services/billing.service.js';
import { config } from '../../config/index.js';


export async function handleCarSpotAction(event: CarSpotActionEventPayload): Promise<void> {
  const carPlate = event.CarPlateNumber || (event as any).PlateNumber || (event as any).CarPlate;
  const carType = event.CarType || 'Normal';
  const rawDirection = event.Direction || 'CarIn';
  const spotName = event.SpotName || '';
  const spotType = event.SpotType || '';

  console.log(
    `[Webhook Handler] CarSpotAction: Car "${carPlate || 'unknown'}" (${carType}) ${rawDirection} at Spot "${spotName || 'ENTRY1'}" (${spotType})`
  );

  const normDirection = rawDirection.toLowerCase();
  const isCarIn = normDirection.includes('in') || normDirection.includes('entry') || normDirection === '';
  const isCarOut = normDirection.includes('out') || normDirection.includes('exit');

  const sNameLower = spotName.toLowerCase();
  const sTypeLower = spotType.toLowerCase();

  const isEntrySpot =
    sTypeLower.includes('entry') ||
    sTypeLower.includes('entrance') ||
    sNameLower.includes('entry') ||
    sNameLower.includes('entrance');

  const isExitSpot =
    sTypeLower.includes('exit') ||
    sNameLower.includes('exit');
  const isLeaveSpot =
    sTypeLower.includes('leave') ||
    sNameLower.includes('escape');

  // 1. Update spot status in DB if DB is available
  if (spotName && !isEntrySpot && !isExitSpot && !isLeaveSpot) {
    const spot = await parkingSpotRepository.findBySimulatorName(spotName).catch(() => null);
    if (spot) {
      const isOccupied = isCarIn;
      await parkingSpotRepository.updateStatuses(spotName, {
        occupancy_status: isOccupied ? 'occupied' : 'free',
      }).catch(() => null);
    }
  }

  // 2. Handle Entrance Arrival & Intelligent Spot Allocation
  if (isEntrySpot && isCarIn) {

    if (config.AUTO_OPEN_GATE_ON_ARRIVAL) {
      console.log(
        `[Auto Allocation] Vehicle "${carPlate || 'car'}" arrived at entrance (${spotName}). Running spot allocation algorithm...`
      );

      // Open Entrance Gate
      try {
        await simulatorClient.openGate('gateA');
      } catch (err: any) {
        console.error(`[Auto Gate Control] Error opening gateA:`, err.message);
      }

      // Also open any closed barrier
      try {
        const barriers = await simulatorClient.listBarriers();
        for (const b of barriers) {
          if (b.State === 'Closed' || b.State === 'Closing') {
            await simulatorClient.openGate(b.Name);
          }
        }
      } catch {
        // Fallback
      }

      // Wait a short duration for barrier opening transition to settle
      await new Promise((resolve) => setTimeout(resolve, 350));

      // Allocate optimal parking spot based on car type & distance
      if (carPlate) {
        try {
          const allocatedSpot = await allocationService.allocateSpot(carPlate, carType);

          if (allocatedSpot) {
            console.log(
              `[Auto Allocation] Allocated optimal spot "${allocatedSpot.Name}" (${allocatedSpot.SpotType}) to car "${carPlate}" (${carType}).`
            );

            // Record parking session in DB
            await sessionService.startSession(carPlate, carType, allocatedSpot.Name);

            // Dispatch car to spot
            const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, allocatedSpot.Name);
            console.log(`[Auto Allocation] Car dispatch result:`, dispatchResult);

            // Issue confirmation dispatch after 300ms to guarantee pathfinding pickup
            setTimeout(async () => {
              await simulatorClient.sendCarToSpot(carPlate, allocatedSpot.Name).catch(() => {});
            }, 300);
          } else {
            console.warn(`[Auto Allocation] No suitable parking spot available for car "${carPlate}".`);
          }
        } catch (err: any) {
          console.error(`[Auto Allocation] Error allocating spot:`, err.message);
        }
      }
    }
    return;
  }

  // 3. Handle car fully leaving the parking lot
  if (isLeaveSpot && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" reached leave spot "${spotName}". Marking departed.`);
    await sessionService.markDeparted(carPlate);
    return;
  }

  // 4. Handle Car Parked in assigned spot
  if (!isEntrySpot && !isExitSpot && !isLeaveSpot && isCarIn && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" has parked in spot "${spotName}".`);
    await sessionService.markParked(carPlate);
    return;
  }

  // 5. Handle Car Unparked / Leaving spot
  if (!isEntrySpot && !isExitSpot && !isLeaveSpot && isCarOut && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" has unparked from spot "${spotName}".`);
    allocationService.releaseReservation(spotName);
    await sessionService.markUnparked(carPlate);
    return;
  }


  // 6. Handle Car Exit from parking lot & Payment Request
  if (isExitSpot && carPlate) {
    if (!isCarIn) {
      console.log(
        `[Auto Exit Control] Ignoring non-arrival exit event for "${carPlate}" at ${spotName} (${rawDirection}).`
      );
      return;
    }

    console.log(
      `[Auto Exit Control] Vehicle "${carPlate}" arrived at exit spot (${spotName}). Requesting simulator payment...`
    );

    try {
      const activeSession = await sessionRepository.findActiveSessionByPlate(carPlate).catch(() => null);
      if (activeSession) {
        if (activeSession.status !== 'ready_to_exit' && activeSession.status !== 'awaiting_payment') {
          console.log(
            `[Auto Exit Control] Ignoring exit spot pass-through for "${carPlate}" while status is "${activeSession.status}".`
          );
          return;
        }

        if (activeSession.status === 'awaiting_payment') {
          console.log(`[Auto Exit Control] Payment already requested for "${carPlate}". Skipping duplicate charge.`);
          return;
        }

        const existingInvoice = await invoiceRepository.findInvoiceByPlateNumber(carPlate).catch(() => null);
        if (existingInvoice?.status === 'paid') {
          console.log(`[Auto Exit Control] "${carPlate}" already paid. Dispatching to leave point.`);
          await simulatorClient.openGate('gateB').catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 350));
          const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1');
          console.log(`[Auto Exit Control] Paid car dispatch result for "${carPlate}":`, dispatchResult);
          return;
        }

        const charge = await billingService.generateSimulatorChargeInvoice(activeSession);
        if (charge.invoice.status !== 'paid') {
          console.log(
            `[Auto Billing] Generated invoice #${charge.invoice.id} for Car "${carPlate}". ` +
              `Requesting simulator charge: parking=${charge.parkingCost}, charging=${charge.chargingCost}, ` +
              `total=${charge.totalCost} (${charge.billableMinutes} min).`
          );
          const chargeResult = await simulatorClient.chargeCar(
            carPlate,
            charge.parkingCost,
            charge.chargingCost
          );
          console.log(`[Auto Billing] Simulator charge result for "${carPlate}":`, chargeResult);
        }
      } else {
        console.warn(`[Auto Exit Control] No active session found for "${carPlate}". Payment request skipped.`);
      }
    } catch (err: any) {
      console.warn(`[Auto Exit Control] Payment request failed for ${carPlate}:`, err.message);
    }

    return;
  }
}



