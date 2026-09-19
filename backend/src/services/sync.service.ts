import { simulatorClient } from '../simulator/client/simulator-client.js';
import { zoneRepository } from '../repositories/zone.repository.js';
import { parkingSpotRepository } from '../repositories/parking-spot.repository.js';
import { deviceRepository } from '../repositories/device.repository.js';

export class BaseDataSyncService {
  public async syncAllBaseData(): Promise<{
    zonesSynced: number;
    spotsSynced: number;
    devicesSynced: number;
  }> {
    // 1. Sync Zones
    const zones = await simulatorClient.listZones();
    let zonesSynced = 0;
    const zoneIdMap = new Map<string, number>();

    for (const z of zones) {
      const dbZone = await zoneRepository.upsertZone(z.Name, z.COLevel);
      zoneIdMap.set(z.Name, dbZone.id);
      zonesSynced++;
    }

    // 2. Sync Parking Spots
    const spots = await simulatorClient.listParkingSpots();
    let spotsSynced = 0;

    for (const s of spots) {
      let zoneId = zoneIdMap.get(s.ZoneParent);
      if (!zoneId) {
        const fallbackZone = await zoneRepository.upsertZone(s.ZoneParent);
        zoneId = fallbackZone.id;
        zoneIdMap.set(s.ZoneParent, zoneId);
      }

      await parkingSpotRepository.upsertSpot({
        simulator_name: s.Name,
        zone_id: zoneId,
        spot_type: (s.SpotType as any) || 'any',
        occupancy_status: s.OccupancyStatus ? (s.OccupancyStatus.toLowerCase() as any) : 'free',
        health_status: s.IsRepairRequested ? 'maintenance' : 'normal',
        usage_count: s.UsageCounter || 0,
      });
      spotsSynced++;
    }

    // 3. Sync Barriers & Devices
    const barriers = await simulatorClient.listBarriers();
    let devicesSynced = 0;

    for (const b of barriers) {
      let zoneId = zoneIdMap.get(b.ZoneParent);
      if (!zoneId) {
        const fallbackZone = await zoneRepository.upsertZone(b.ZoneParent);
        zoneId = fallbackZone.id;
        zoneIdMap.set(b.ZoneParent, zoneId);
      }

      await deviceRepository.upsertDevice({
        simulator_name: b.Name,
        device_type: 'gate',
        zone_id: zoneId,
        operating_state: b.State,
        health_status: b.IsRepairRequested ? 'maintenance' : 'normal',
        usage_count: b.UsageCounter || 0,
      });
      devicesSynced++;
    }

    // 4. Sync Lights
    const lights = await simulatorClient.listLights();
    for (const l of lights) {
      let zoneId = zoneIdMap.get(l.ZoneParent);
      if (!zoneId) {
        const fallbackZone = await zoneRepository.upsertZone(l.ZoneParent);
        zoneId = fallbackZone.id;
        zoneIdMap.set(l.ZoneParent, zoneId);
      }

      await deviceRepository.upsertDevice({
        simulator_name: l.Name,
        device_type: 'light',
        zone_id: zoneId,
        group_name: l.Group,
        operating_state: l.IsOn ? 'On' : 'Off',
      });
      devicesSynced++;
    }

    // 5. Sync Exhaust Fans
    const fans = await simulatorClient.listExhaustFans();
    for (const f of fans) {
      let zoneId = zoneIdMap.get(f.ZoneParent);
      if (!zoneId) {
        const fallbackZone = await zoneRepository.upsertZone(f.ZoneParent);
        zoneId = fallbackZone.id;
        zoneIdMap.set(f.ZoneParent, zoneId);
      }

      await deviceRepository.upsertDevice({
        simulator_name: f.Name,
        device_type: 'fan',
        zone_id: zoneId,
        group_name: f.Group || null,
        operating_state: f.IsOn ? 'On' : 'Off',
        health_status: f.IsRepairRequested ? 'maintenance' : 'normal',
      });
      devicesSynced++;
    }

    return { zonesSynced, spotsSynced, devicesSynced };
  }
}

export const syncService = new BaseDataSyncService();
