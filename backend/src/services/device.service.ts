import { config } from '../config/index.js';
import { simulatorClient, GateActionResult } from '../simulator/client/simulator-client.js';
import { deviceRepository } from '../repositories/device.repository.js';

export class DeviceService {
  public async executeCommand(
    deviceName: string,
    command: 'open' | 'close' | 'repair'
  ): Promise<GateActionResult> {
    if (!config.ENABLE_DEVICE_CONTROL_ROUTE) {
      throw {
        status: 403,
        message: 'Anonymous device control is disabled until user authentication is enabled.',
      };
    }

    const device = await deviceRepository.findBySimulatorName(deviceName);
    if (!device) {
      throw {
        status: 404,
        message: `Device "${deviceName}" not found in system repository.`,
      };
    }

    if (device.device_type !== 'gate') {
      throw {
        status: 400,
        message: `Command "${command}" is only supported for gate devices. Target is "${device.device_type}".`,
      };
    }

    let result: GateActionResult;
    if (command === 'open') {
      result = await simulatorClient.openGate(deviceName);
    } else if (command === 'close') {
      result = await simulatorClient.closeGate(deviceName);
    } else {
      result = await simulatorClient.repairGate(deviceName);
    }

    if (result.accepted && result.gateState) {
      await deviceRepository.updateState(deviceName, {
        operating_state: result.gateState,
      });
    }

    return result;
  }
}

export const deviceService = new DeviceService();
