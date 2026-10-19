/**
 * Standalone simulator CLI — produces a burst of SIMULATED dispenser events and
 * sends them through the same authenticated cloud ingestion path as a real
 * gateway. Useful for demos and for testing offline/duplicate behaviour.
 *
 * Usage:
 *   PETROFLOW_DEVICE_KEY=pfk_... npm run simulate -w @petroflow/gateway
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { CloudClient } from './client.js';
import { SimulatedDispenserAdapter } from './adapters/simulated.js';

const ROOT = path.resolve(process.cwd(), '../..');
dotenv.config({ path: path.join(ROOT, '.env') });

const API_URL = process.env.PETROFLOW_API_URL ?? 'http://127.0.0.1:4000';
const DEVICE_KEY = process.env.PETROFLOW_DEVICE_KEY ?? '';
if (!DEVICE_KEY) {
  console.error('Set PETROFLOW_DEVICE_KEY to a key issued by the ERP device registry.');
  process.exit(1);
}

const adapter = new SimulatedDispenserAdapter({
  id: 'simulator',
  vendor: 'PetroFlow',
  protocol: 'Simulator v1',
  seed: Number(process.env.PETROFLOW_SIM_SEED ?? 7),
  minLitresPerPoll: Number(process.env.PETROFLOW_SIM_MIN ?? 5),
  maxLitresPerPoll: Number(process.env.PETROFLOW_SIM_MAX ?? 60),
});
const client = new CloudClient({ baseUrl: API_URL, deviceKey: DEVICE_KEY });

async function run() {
  await adapter.connect();
  const iterations = Number(process.env.PETROFLOW_SIM_ITERATIONS ?? 3);
  await client.heartbeat('simulator-cli-1.0.0', 0);

  for (let i = 0; i < iterations; i += 1) {
    const events = await adapter.poll();
    const result = await client.sendEvents(events);
    console.log(
      `iteration ${i + 1}: accepted=${result.accepted} duplicates=${result.duplicates} rejected=${result.rejected}`,
    );
    for (const item of result.results) {
      if (item.status !== 'PROCESSED') console.log('  ', item.eventId, item.status, item.reason ?? '');
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  console.log('SIMULATED events submitted. All readings are marked SIMULATED in the ERP.');
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
