import { CarSpotActionEventPayload } from '../models/webhook-event.model.js';
import { parkingSpotRepository } from '../../repositories/parking-spot.repository.js';
import { sessionRepository } from '../../repositories/session.repository.js';
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

  // 1. Update spot status in DB if DB is available
  if (spotName && !isEntrySpot && !isExitSpot) {
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


  // 3. Handle Car Parked in assigned spot
  if (!isEntrySpot && !isExitSpot && isCarIn && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" has parked in spot "${spotName}".`);
    await sessionService.markParked(carPlate);
    return;
  }

  // 4. Handle Car Unparked / Leaving spot
  if (!isEntrySpot && !isExitSpot && isCarOut && carPlate) {
    console.log(`[Session Lifecycle] Car "${carPlate}" has unparked from spot "${spotName}".`);
    allocationService.releaseReservation(spotName);
    await sessionService.markUnparked(carPlate);
    return;
  }


  // 5. Handle Car Exit from parking lot & Payment Clearance
  if (isExitSpot && carPlate) {
    console.log(
      `[Auto Exit Control] Vehicle "${carPlate}" arrived at exit spot (${spotName}). Processing billing invoice & payment clearance...`
    );

    // Generate invoice if needed & clear payment
    try {
      const activeSession = await sessionRepository.findActiveSessionByPlate(carPlate).catch(() => null);
      if (activeSession) {
        const invoice = await billingService.generateInvoiceForSession(activeSession.id);
        if (invoice && invoice.status !== 'paid') {
          console.log(
            `[Auto Billing] Generated invoice #${invoice.id} for Car "${carPlate}". Amount due: ${invoice.amount_due_minor} minor units (${invoice.billable_minutes} min).`
          );
          await billingService.processPaymentEvent({
            EventClass: 'payment_made',
            CarPlateNumber: carPlate,
            Amount: invoice.amount_due_minor,
            EventId: `pay_${Date.now()}_${carPlate.replace(/\s+/g, '')}`,
          });
        }
      }
    } catch (err: any) {
      console.warn(`[Auto Exit Control] Auto billing notice for ${carPlate}:`, err.message);
    }

    // Open Exit Gate (gateB)

    try {
      await simulatorClient.openGate('gateB');
    } catch (err: any) {
      console.error(`[Auto Exit Gate Control] Error opening gateB:`, err.message);
    }

    // Open any closed barrier
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

    // Wait a short duration for exit barrier opening transition to settle
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Send car past the exit gate out of the parking lot
    try {
      const dispatchResult = await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1');
      console.log(`[Auto Exit Control] Dispatching vehicle "${carPlate}" to ESCAPE1:`, dispatchResult);

      // Issue confirmation dispatch after 300ms to guarantee pathfinding pickup
      setTimeout(async () => {
        await simulatorClient.sendCarToSpot(carPlate, 'ESCAPE1').catch(() => {});
      }, 300);
    } catch {
      // Fallback
    }

    console.log(`[Session Lifecycle] Car "${carPlate}" has exited the parking lot.`);
    await sessionService.markDeparted(carPlate);
    return;
  }
}



