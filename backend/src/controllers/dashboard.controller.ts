import { Request, Response, NextFunction } from 'express';
import { invoiceRepository } from '../repositories/invoice.repository.js';
import { paymentAttemptRepository } from '../repositories/payment-attempt.repository.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { billingService } from '../services/billing.service.js';
import { allocationService } from '../services/allocation.service.js';
import { db } from '../database/postgres.js';

export async function getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    let activeSessions = await sessionRepository.findAllActiveSessions().catch(() => []);
    let invoices = await invoiceRepository.findAllInvoices().catch(() => []);
    let attempts = await paymentAttemptRepository.findAllAttempts().catch(() => []);

    let spotCount = 0;
    let occupiedCount = 0;
    let detectedCarsTotal = 0;

    try {
      const spots = await simulatorClient.listParkingSpots();
      spotCount = spots.length;
      occupiedCount = spots.filter((s: any) => s.detectedCars > 0 || s.OccupancyStatus === 'Occupied').length;
      detectedCarsTotal = spots.reduce((sum: number, s: any) => sum + (s.detectedCars || 0), 0);
    } catch {
      // Fallback
    }

    // Auto-detect simulator reset: If simulator has 0 occupied spots & 0 detected cars, but activeSessions > 0:
    if (spotCount > 0 && occupiedCount === 0 && detectedCarsTotal === 0 && activeSessions.length > 0) {
      console.log('[Dashboard Controller] Simulator reset detected (0 cars inside). Resetting backend active sessions & invoices.');
      sessionRepository.clearAll();
      invoiceRepository.clearAll();
      paymentAttemptRepository.clearAll();
      allocationService.clearAllReservations();

      try {
        await db.query('TRUNCATE TABLE payment_attempts, invoices, parking_sessions RESTART IDENTITY CASCADE');
      } catch {
        // Ignored if DB is offline
      }

      activeSessions = [];
      invoices = [];
      attempts = [];
    }

    let totalRevenueMinor = 0;
    for (const inv of invoices) {
      if (inv.status === 'paid') {
        totalRevenueMinor += Number(inv.amount_due_minor || 0);
      }
    }

    // Cars inside the parking facility = count of active parking sessions currently in the lot
    const carsInsideCount = activeSessions.length;

    res.status(200).json({
      data: {
        activeSessionsCount: carsInsideCount,
        totalInvoicesCount: invoices.length,
        totalRevenueMinor,
        spots: {
          total: spotCount,
          occupied: occupiedCount,
          free: Math.max(0, spotCount - occupiedCount),
        },
        paymentAttemptsCount: attempts.length,
        recentAttempts: attempts.slice(0, 10),
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function listInvoices(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const invoices = await invoiceRepository.findAllInvoices().catch(() => []);
    const attempts = await paymentAttemptRepository.findAllAttempts().catch(() => []);

    res.status(200).json({
      data: {
        count: invoices.length,
        invoices: invoices.map((inv) => ({
          ...inv,
          attempts: attempts.filter((att) => att.invoice_id === inv.id),
        })),
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function simulatePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plateNumber, amount, paymentId } = req.body || {};

    if (!plateNumber || typeof plateNumber !== 'string') {
      res.status(400).json({
        error: { code: 'INVALID_PARAM', message: 'plateNumber is required' },
        requestId: req.requestId,
      });
      return;
    }

    const result = await billingService.processPaymentEvent({
      EventClass: 'payment_made',
      CarPlateNumber: plateNumber,
      Amount: amount !== undefined ? Number(amount) : 500,
      EventId: paymentId || `sim_pay_${Date.now()}`,
    });

    res.status(200).json({
      data: result,
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}

export async function resetSystemState(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    console.log('[System Reset] Resetting all sessions, invoices, payment attempts, and spot reservations.');
    sessionRepository.clearAll();
    invoiceRepository.clearAll();
    paymentAttemptRepository.clearAll();
    allocationService.clearAllReservations();

    try {
      await db.query('TRUNCATE TABLE payment_attempts, invoices, parking_sessions RESTART IDENTITY CASCADE');
    } catch {
      // Ignored if DB is offline
    }

    res.status(200).json({
      data: {
        success: true,
        message: 'System state, parking sessions, invoices, and payment attempts cleared successfully.',
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
}
