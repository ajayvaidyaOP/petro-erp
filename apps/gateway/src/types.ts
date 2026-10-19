/**
 * PetroFlow hardware adapter contract (v1.0.0).
 *
 * A vendor adapter translates a specific forecourt controller protocol
 * (serial, TCP, vendor SDK) into one of the two canonical event shapes below.
 * There is no universal dispenser protocol: each adapter must be implemented
 * and validated against documented vendor registers/commands on real hardware.
 */
export type EventType = 'TOTALIZER_SNAPSHOT' | 'TRANSACTION';

export interface TotalizerSnapshot {
  eventId: string;
  type: 'TOTALIZER_SNAPSHOT';
  sequence: number;
  occurredAt: string;
  dispenserCode: string;
  nozzleNumber: number;
  /** Cumulative totalizer value, exactly as read from the device. */
  value: string;
  unit: string;
}

export interface DispenserTransaction {
  eventId: string;
  type: 'TRANSACTION';
  sequence: number;
  occurredAt: string;
  dispenserCode: string;
  nozzleNumber: number;
  litres: string;
  unitPrice?: string;
  paymentMode?: 'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CREDIT';
  reference?: string;
}

export type GatewayEvent = TotalizerSnapshot | DispenserTransaction;

export interface NozzleIdentity {
  dispenserCode: string;
  nozzleNumber: number;
  productCode?: string;
}

export interface DispenserAdapter {
  readonly vendor: string;
  readonly protocol: string;
  readonly supportedEventTypes: readonly EventType[];
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /** Discover the nozzles physically wired to this gateway/controller. */
  discoverNozzles(): Promise<NozzleIdentity[]>;
  /**
   * Poll for new events since the previous poll. Adapters that provide
   * cumulative snapshots should return the latest snapshot per nozzle.
   */
  poll(): Promise<GatewayEvent[]>;
}

export interface AdapterConfig {
  id: string;
  vendor: string;
  protocol: string;
  host?: string;
  port?: number;
  serialPort?: string;
  baudRate?: number;
  registerMapFile?: string;
  /** Simulator-specific options */
  seed?: number;
  minLitresPerPoll?: number;
  maxLitresPerPoll?: number;
}
