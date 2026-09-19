import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { allocationService } from '../src/services/allocation.service.js';
import { simulatorClient } from '../src/simulator/client/simulator-client.js';
import { recommendSpot } from '../src/controllers/allocation.controller.js';
import { requestIdMiddleware } from '../src/middleware/request-id.middleware.js';
import { SimulatorParkingSpotDto } from '../src/simulator/models/simulator.model.js';

describe('AllocationService Unit Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const sampleSpots: SimulatorParkingSpotDto[] = [
    { Name: 'ENTRY1', SpotType: 'Entry', OccupancyStatus: 'Free', IsRepairRequested: false, X: 300, Y: 900 } as any,
    { Name: 'SPOT_ELE_FAR', SpotType: 'Electric', OccupancyStatus: 'Free', IsRepairRequested: false, X: 800, Y: 800 } as any,
    { Name: 'SPOT_ELE_CLOSE', SpotType: 'Electric', OccupancyStatus: 'Free', IsRepairRequested: false, X: 350, Y: 850 } as any,
    { Name: 'SPOT_ACC_1', SpotType: 'Accessible', OccupancyStatus: 'Free', IsRepairRequested: false, X: 400, Y: 800 } as any,
    { Name: 'SPOT_NOR_FAR', SpotType: 'Any', OccupancyStatus: 'Free', IsRepairRequested: false, X: 600, Y: 600 } as any,
    { Name: 'SPOT_NOR_CLOSE', SpotType: 'Any', OccupancyStatus: 'Free', IsRepairRequested: false, X: 320, Y: 880 } as any,
    { Name: 'SPOT_OCCUPIED', SpotType: 'Any', OccupancyStatus: 'Occupied', IsRepairRequested: false, X: 310, Y: 890 } as any,
    { Name: 'SPOT_REPAIR', SpotType: 'Electric', OccupancyStatus: 'Free', IsRepairRequested: true, X: 310, Y: 890 } as any,
  ];

  it('should allocate closer Electric spot for Electric car', async () => {
    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValue(sampleSpots);

    const result = await allocationService.allocateSpot('EV-123', 'Electric', { x: 300, y: 900 });
    expect(result).not.toBeNull();
    expect(result?.Name).toBe('SPOT_ELE_CLOSE');
  });

  it('should allocate Accessible spot for Accessible car', async () => {
    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValue(sampleSpots);

    const result = await allocationService.allocateSpot('ACC-001', 'Accessible', { x: 300, y: 900 });
    expect(result).not.toBeNull();
    expect(result?.Name).toBe('SPOT_ACC_1');
  });

  it('should allocate closer Any spot for Normal car', async () => {
    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValue(sampleSpots);

    const result = await allocationService.allocateSpot('NOR-888', 'Normal', { x: 300, y: 900 });
    expect(result).not.toBeNull();
    expect(result?.Name).toBe('SPOT_NOR_CLOSE');
  });

  it('should use simulator CarType and entry coordinates when ranking available spots', async () => {
    allocationService.clearAllReservations();
    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValue([
      { Name: 'ENTRY1', Purpose: 'EntrySpot', CarType: 'Any', X: 100, Y: 100 } as any,
      { Name: 'EV_FAR', Purpose: 'Park', CarType: 'Electric', X: 900, Y: 900 } as any,
      { Name: 'EV_CLOSE', Purpose: 'Park', CarType: 'Electric', X: 120, Y: 120 } as any,
      { Name: 'ANY_CLOSEST', Purpose: 'Park', CarType: 'Any', X: 105, Y: 105 } as any,
    ]);

    const result = await allocationService.allocateSpotForEntry('EV-456', 'Electric', 'ENTRY1');
    expect(result).not.toBeNull();
    expect(result?.Name).toBe('EV_CLOSE');
  });

  it('should filter out entry/exit, occupied, and repair requested spots', async () => {
    const restrictedSpots: SimulatorParkingSpotDto[] = [
      { Name: 'ENTRY1', SpotType: 'Entry', OccupancyStatus: 'Occupied', IsRepairRequested: false } as any,
      { Name: 'EXIT1', SpotType: 'Exit', OccupancyStatus: 'Free', IsRepairRequested: false } as any,
      { Name: 'SPOT_OCC', SpotType: 'Any', OccupancyStatus: 'Occupied', IsRepairRequested: false } as any,
      { Name: 'SPOT_REP', SpotType: 'Any', OccupancyStatus: 'Free', IsRepairRequested: true } as any,
    ];

    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValueOnce(restrictedSpots);

    const result = await allocationService.allocateSpot('TEST-000', 'Normal');
    expect(result).toBeNull();
  });


  it('should prevent assigning the same spot to two cars arriving in quick succession', async () => {
    allocationService.clearAllReservations();
    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValue(sampleSpots);

    // Car 1 arrives and gets SPOT_NOR_CLOSE
    const car1Result = await allocationService.allocateSpot('CAR-111', 'Normal', { x: 300, y: 900 });
    expect(car1Result?.Name).toBe('SPOT_NOR_CLOSE');

    // Car 2 arrives immediately after (while simulator still reports SPOT_NOR_CLOSE as Free)
    const car2Result = await allocationService.allocateSpot('CAR-222', 'Normal', { x: 300, y: 900 });
    // Car 2 must NOT get SPOT_NOR_CLOSE again; it should get SPOT_NOR_FAR!
    expect(car2Result?.Name).toBe('SPOT_NOR_FAR');
  });
});



describe('Allocation Controller API Integration Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POST /api/allocation/recommend should return recommended spot', async () => {
    const sampleSpots: SimulatorParkingSpotDto[] = [
      { Name: 'A-101', SpotType: 'Any', OccupancyStatus: 'Free', IsRepairRequested: false, X: 310, Y: 890 } as any,
    ];
    vi.spyOn(simulatorClient, 'listParkingSpots').mockResolvedValue(sampleSpots);

    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.post('/api/allocation/recommend', recommendSpot);

    const server = app.listen(0);
    const address = server.address() as any;

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/allocation/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plateNumber: 'CAR-999', carType: 'Normal' }),
      });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.data.allocated).toBe(true);
      expect(json.data.recommendedSpot.Name).toBe('A-101');
    } finally {
      server.close();
    }
  });

  it('POST /api/allocation/recommend should return 400 on missing plateNumber', async () => {
    const app = express();
    app.use(express.json());
    app.use(requestIdMiddleware);
    app.post('/api/allocation/recommend', recommendSpot);

    const server = app.listen(0);
    const address = server.address() as any;

    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/api/allocation/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ carType: 'Normal' }),
      });
      const json = await res.json();
      expect(res.status).toBe(400);
      expect(json.error.code).toBe('INVALID_PARAM');
    } finally {
      server.close();
    }
  });
});
