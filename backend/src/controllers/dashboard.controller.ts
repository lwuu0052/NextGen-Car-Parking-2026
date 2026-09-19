import { Request, Response, NextFunction } from 'express';
import { invoiceRepository } from '../repositories/invoice.repository.js';
import { paymentAttemptRepository } from '../repositories/payment-attempt.repository.js';
import { sessionRepository } from '../repositories/session.repository.js';
import { simulatorClient } from '../simulator/client/simulator-client.js';
import { billingService } from '../services/billing.service.js';

export async function getDashboardStats(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const activeSessions = await sessionRepository.findAllActiveSessions().catch(() => []);
    const invoices = await invoiceRepository.findAllInvoices().catch(() => []);
    const attempts = await paymentAttemptRepository.findAllAttempts().catch(() => []);

    let totalRevenueMinor = 0;
    for (const inv of invoices) {
      if (inv.status === 'paid') {
        totalRevenueMinor += Number(inv.amount_due_minor || 0);
      }
    }

    let spotCount = 0;
    let occupiedCount = 0;
    try {
      const spots = await simulatorClient.listParkingSpots();
      spotCount = spots.length;
      occupiedCount = spots.filter((s: any) => s.detectedCars > 0 || s.OccupancyStatus === 'Occupied').length;
    } catch {
      // Fallback
    }

    res.status(200).json({
      data: {
        activeSessionsCount: activeSessions.length,
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
