import { Router } from 'express';
import { getLiveHealth, getReadyHealth } from '../controllers/health.controller.js';
import { getParkingSpots, getDevices, postDeviceCommand } from '../controllers/parking.controller.js';
import { handleSimulatorWebhook } from '../controllers/webhook.controller.js';
import { recommendSpot, getActiveSessions } from '../controllers/allocation.controller.js';
import { getDashboardStats, listInvoices, simulatePayment, resetSystemState } from '../controllers/dashboard.controller.js';
import { syncService } from '../services/sync.service.js';

export const router = Router();

// Health check endpoints
router.get('/health/live', getLiveHealth);
router.get('/health/ready', getReadyHealth);

// Public / Operator query endpoints
router.get('/api/parking-spots', getParkingSpots);
router.get('/api/devices', getDevices);
router.post('/api/devices/:id/commands', postDeviceCommand);

// Intelligent Parking Spot Allocation & Session endpoints
router.post('/api/allocation/recommend', recommendSpot);
router.get('/api/sessions/active', getActiveSessions);

// Dashboard & Billing API endpoints
router.get('/api/dashboard/stats', getDashboardStats);
router.get('/api/invoices', listInvoices);
router.post('/api/payments/simulate', simulatePayment);
router.post('/api/system/reset', resetSystemState);


// Base data sync endpoint
router.post('/api/sync/base-data', async (req, res, next) => {
  try {
    const result = await syncService.syncAllBaseData();
    res.status(200).json({
      data: {
        message: 'Base data synchronized successfully',
        ...result,
      },
      requestId: req.requestId,
    });
  } catch (err) {
    next(err);
  }
});

// Simulator Webhook Receiver endpoint
router.post('/webhooks/simulator', handleSimulatorWebhook);

