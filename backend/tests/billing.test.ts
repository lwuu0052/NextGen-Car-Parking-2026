import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { billingService } from '../src/services/billing.service.js';
import { invoiceRepository } from '../src/repositories/invoice.repository.js';
import { paymentAttemptRepository } from '../src/repositories/payment-attempt.repository.js';
import { sessionRepository } from '../src/repositories/session.repository.js';
import { getDashboardStats, listInvoices, simulatePayment } from '../src/controllers/dashboard.controller.js';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';

describe('Billing Engine & Anti-Fraud Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate invoice with correct elapsed minute fee calculation', async () => {
    const fakeSession = {
      id: 101,
      plate_number: 'TEST-888',
      car_type: 'Normal',
      parking_spot_id: 1,
      status: 'parked',
      arrived_at: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
    } as any;

    vi.spyOn(sessionRepository, 'findAllActiveSessions').mockResolvedValue([fakeSession]);
    vi.spyOn(sessionRepository, 'updateStatus').mockResolvedValue({ ...fakeSession, status: 'awaiting_payment' });

    const invoice = await billingService.generateInvoiceForSession(101, 200); // 2.00 / min
    expect(invoice).not.toBeNull();
    expect(invoice?.billable_minutes).toBeGreaterThanOrEqual(10);
    expect(invoice?.amount_due_minor).toBe((invoice?.billable_minutes || 0) * 200);
    expect(invoice?.status).toBe('pending');
  });

  it('should REJECT underpaid payment attempt due to Anti-Fraud amount rule', async () => {
    const fakeInvoice = {
      id: 201,
      parking_session_id: 102,
      billable_minutes: 5,
      rate_per_minute_minor: 200,
      amount_due_minor: 1000, // Requires 1000 minor units ($10.00)
      status: 'pending',
    } as any;

    vi.spyOn(invoiceRepository, 'findInvoiceByPlateNumber').mockResolvedValue(fakeInvoice);

    // Payment attempt with only 500 (underpaid fraud attempt)
    const result = await billingService.processPaymentEvent({
      EventClass: 'payment_made',
      CarPlateNumber: 'FRAUD-001',
      Amount: 500, // Underpaid!
      EventId: 'evt_fraud_123',
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe('INSUFFICIENT_AMOUNT');
    expect(result.attempt?.verification_status).toBe('invalid');
  });

  it('should ACCEPT valid payment attempt and mark invoice as paid', async () => {
    const fakeInvoice = {
      id: 202,
      parking_session_id: 103,
      billable_minutes: 5,
      rate_per_minute_minor: 200,
      amount_due_minor: 1000,
      status: 'pending',
    } as any;

    const fakeSession = {
      id: 103,
      plate_number: 'VALID-999',
      status: 'awaiting_payment',
    } as any;

    vi.spyOn(invoiceRepository, 'findInvoiceByPlateNumber').mockResolvedValue(fakeInvoice);
    vi.spyOn(sessionRepository, 'findActiveSessionByPlate').mockResolvedValue(fakeSession);

    const result = await billingService.processPaymentEvent({
      EventClass: 'payment_made',
      CarPlateNumber: 'VALID-999',
      Amount: 1000, // Full payment
      EventId: 'evt_valid_456',
    });

    expect(result.success).toBe(true);
    expect(result.invoice?.status).toBe('paid');
    expect(result.attempt?.verification_status).toBe('valid');
  });

  it('should ignore duplicate payment attempt on already paid invoice (Idempotency)', async () => {
    const paidInvoice = {
      id: 203,
      parking_session_id: 104,
      amount_due_minor: 1000,
      status: 'paid',
    } as any;

    vi.spyOn(invoiceRepository, 'findInvoiceByPlateNumber').mockResolvedValue(paidInvoice);

    const result = await billingService.processPaymentEvent({
      EventClass: 'payment_made',
      CarPlateNumber: 'PAID-777',
      Amount: 1000,
      EventId: 'evt_dup_789',
    });

    expect(result.success).toBe(true);
    expect(result.isDuplicate).toBe(true);
  });
});

describe('Dashboard API Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('GET /api/dashboard/stats should return metrics summary', async () => {
    const app = express();
    app.use(requestIdMiddleware);
    app.get('/api/dashboard/stats', getDashboardStats);

    const server = app.listen(0);
    const address = server.address() as any;

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/dashboard/stats`);
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.activeSessionsCount).toBeDefined();
      expect(json.data.totalRevenueMinor).toBeDefined();
      expect(json.data.spots).toBeDefined();
    } finally {
      server.close();
    }
  });

  it('POST /api/payments/simulate should execute simulated payment', async () => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.post('/api/payments/simulate', simulatePayment);

    const server = app.listen(0);
    const address = server.address() as any;

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/payments/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateNumber: 'SIM-001', amount: 1000 }),
      });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.success).toBe(true);
    } finally {
      server.close();
    }
  });
});
