import type { AdapterConfig, DispenserAdapter } from '../types.js';
import { SimulatedDispenserAdapter } from './simulated.js';
import { ModbusTcpDispenserAdapter } from './modbusTcp.js';

export * from './simulated.js';
export * from './modbusTcp.js';

/**
 * Adapter registry. Add vendor adapters here after they are implemented and
 * certified against a real controller.
 */
export function createAdapter(config: AdapterConfig): DispenserAdapter {
  switch (config.protocol.toLowerCase()) {
    case 'simulator':
    case 'simulator v1':
      return new SimulatedDispenserAdapter(config);
    case 'modbus':
    case 'modbus tcp':
      return new ModbusTcpDispenserAdapter(config);
    default:
      throw new Error(
        `Unknown adapter protocol "${config.protocol}". Supported: Simulator v1 (verified), Modbus TCP (scaffold).`,
      );
  }
}
