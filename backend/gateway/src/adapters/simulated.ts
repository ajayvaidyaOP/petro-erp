import { randomUUID } from 'node:crypto';
import type {
  AdapterConfig,
  DispenserAdapter,
  GatewayEvent,
  NozzleIdentity,
  TotalizerSnapshot,
} from '../types.js';

interface SimNozzleState {
  dispenserCode: string;
  nozzleNumber: number;
  productCode: string;
  totalizer: number;
  sequence: number;
}

/**
 * Simulated dispenser adapter.
 *
 * This is NOT a hardware driver. It produces realistic cumulative totalizer
 * snapshots and transaction events so the complete cloud pipeline can be
 * exercised. All readings are labelled SIMULATED end-to-end.
 */
export class SimulatedDispenserAdapter implements DispenserAdapter {
  readonly vendor = 'PetroFlow';
  readonly protocol = 'Simulator v1';
  readonly supportedEventTypes = ['TOTALIZER_SNAPSHOT', 'TRANSACTION'] as const;
  private connected = false;
  private nozzles: SimNozzleState[] = [];
  private options: Required<Pick<AdapterConfig, 'minLitresPerPoll' | 'maxLitresPerPoll'>>;

  constructor(private config: AdapterConfig) {
    this.options = {
      minLitresPerPoll: config.minLitresPerPoll ?? 2,
      maxLitresPerPoll: config.maxLitresPerPoll ?? 45,
    };
  }

  async connect() {
    const seed = this.config.seed ?? 42;
    this.nozzles = [
      { dispenserCode: 'D1', nozzleNumber: 1, productCode: 'MS', totalizer: 50000 + seed, sequence: 0 },
      { dispenserCode: 'D1', nozzleNumber: 2, productCode: 'HSD', totalizer: 42000 + seed, sequence: 0 },
      { dispenserCode: 'D2', nozzleNumber: 1, productCode: 'XP95', totalizer: 31000 + seed, sequence: 0 },
      { dispenserCode: 'D2', nozzleNumber: 2, productCode: 'HSD', totalizer: 61000 + seed, sequence: 0 },
    ];
    this.connected = true;
  }

  async disconnect() {
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }

  async discoverNozzles(): Promise<NozzleIdentity[]> {
    return this.nozzles.map((n) => ({
      dispenserCode: n.dispenserCode,
      nozzleNumber: n.nozzleNumber,
      productCode: n.productCode,
    }));
  }

  async poll(): Promise<GatewayEvent[]> {
    if (!this.connected) throw new Error('Simulated adapter is not connected');
    const { minLitresPerPoll, maxLitresPerPoll } = this.options;
    const events: TotalizerSnapshot[] = [];
    for (const nozzle of this.nozzles) {
      const litres = minLitresPerPoll + Math.random() * (maxLitresPerPoll - minLitresPerPoll);
      nozzle.totalizer = Number((nozzle.totalizer + litres).toFixed(3));
      nozzle.sequence += 1;
      events.push({
        eventId: `SIM-${Date.now()}-${nozzle.dispenserCode}${nozzle.nozzleNumber}-${randomUUID().slice(0, 8)}`,
        type: 'TOTALIZER_SNAPSHOT',
        sequence: nozzle.sequence,
        occurredAt: new Date().toISOString(),
        dispenserCode: nozzle.dispenserCode,
        nozzleNumber: nozzle.nozzleNumber,
        value: nozzle.totalizer.toFixed(3),
        unit: 'L',
      });
    }
    return events;
  }

  /** Used by the standalone simulator CLI to inject a controlled jump/reset. */
  forceValue(dispenserCode: string, nozzleNumber: number, value: number) {
    const nozzle = this.nozzles.find(
      (n) => n.dispenserCode === dispenserCode && n.nozzleNumber === nozzleNumber,
    );
    if (nozzle) nozzle.totalizer = value;
  }
}
