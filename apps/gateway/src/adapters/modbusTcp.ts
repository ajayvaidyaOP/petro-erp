import type {
  AdapterConfig,
  DispenserAdapter,
  EventType,
  GatewayEvent,
  NozzleIdentity,
} from '../types.js';

/**
 * Modbus/TCP adapter SCAFFOLD — intentionally not certified.
 *
 * Many forecourt controllers expose totalizers over Modbus/TCP, but register
 * addresses, word order, scaling factors and nozzle indexing are vendor and
 * firmware specific. This class documents the integration contract and fails
 * loudly instead of pretending to read hardware.
 *
 * To implement for a real controller:
 *  1. Obtain the vendor's documented register map and obtain written approval
 *     to integrate.
 *  2. Fill `registerMap` from a local JSON file (never hard-code customer maps).
 *  3. Implement `readRegister` using a maintained Modbus client.
 *  4. Verify scaling/precision against the physical dispenser display.
 *  5. Validate under supervised test conditions before production use.
 */
export interface RegisterMap {
  unitId: number;
  /** one entry per nozzle */
  nozzles: {
    dispenserCode: string;
    nozzleNumber: number;
    totalizerRegister: number;
    registerCount: number;
    scale: number;
    wordOrder?: 'BIG_ENDIAN' | 'LITTLE_ENDIAN';
  }[];
}

export class ModbusTcpDispenserAdapter implements DispenserAdapter {
  readonly vendor = 'Generic Modbus/TCP';
  readonly protocol = 'Modbus TCP';
  readonly supportedEventTypes: readonly EventType[] = ['TOTALIZER_SNAPSHOT'];
  private connected = false;
  private sequence = 0;

  constructor(private config: AdapterConfig) {}

  async connect(): Promise<void> {
    if (!this.config.host || !this.config.port) {
      throw new Error(
        'Modbus adapter requires host/port and a vendor register map. Refusing to start without a ' +
          'documented protocol.',
      );
    }
    throw new Error(
      'Modbus adapter is a documented scaffold only. Real hardware integration is UNVERIFIED. ' +
        'Implement readRegister() for your certified controller and register map before enabling.',
    );
  }

  async disconnect() {
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  async discoverNozzles(): Promise<NozzleIdentity[]> {
    return [];
  }

  async poll(): Promise<GatewayEvent[]> {
    this.sequence += 1;
    throw new Error('Modbus adapter is not implemented for physical devices.');
  }
}
