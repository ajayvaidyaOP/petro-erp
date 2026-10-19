import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { EventSpool } from './spool.js';
import { CloudClient } from './client.js';
import { createAdapter } from './adapters/index.js';
import type { GatewayEvent } from './types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(ROOT, '.env') });

const API_URL = process.env.PETROFLOW_API_URL ?? 'http://127.0.0.1:4000';
const DEVICE_KEY = process.env.PETROFLOW_DEVICE_KEY ?? '';
const SPOOL_FILE = path.resolve(
  ROOT,
  process.env.PETROFLOW_SPOOL_FILE ?? 'db/gateway-spool.ndjson',
);
const POLL_INTERVAL_MS = Number(process.env.PETROFLOW_POLL_MS ?? 30_000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.PETROFLOW_HEARTBEAT_MS ?? 60_000);
const FIRMWARE = 'gateway-1.0.0-sim';

if (!DEVICE_KEY) {
  console.error(
    '[gateway] PETROFLOW_DEVICE_KEY is not set. Register a device in the ERP and paste the one-time key into .env.',
  );
  process.exit(1);
}

const adapter = createAdapter({
  id: 'primary',
  vendor: process.env.PETROFLOW_ADAPTER_VENDOR ?? 'PetroFlow',
  protocol: process.env.PETROFLOW_ADAPTER_PROTOCOL ?? 'Simulator v1',
  host: process.env.PETROFLOW_ADAPTER_HOST,
  port: process.env.PETROFLOW_ADAPTER_PORT ? Number(process.env.PETROFLOW_ADAPTER_PORT) : undefined,
  seed: Number(process.env.PETROFLOW_SIM_SEED ?? 42),
});

const spool = new EventSpool(SPOOL_FILE);
const client = new CloudClient({ baseUrl: API_URL, deviceKey: DEVICE_KEY });

let shuttingDown = false;

async function flush() {
  const batch = spool.peek(100);
  if (batch.length === 0) return { sent: 0, remaining: 0 };
  try {
    const result = await client.sendEvents(batch);
    const acknowledged = new Set<string>();
    for (const item of result.results) {
      // Duplicates, rejections and errors are terminal at the spool level; the
      // cloud already stores the raw event and error for diagnostics.
      if (['PROCESSED', 'DUPLICATE', 'REJECTED'].includes(item.status)) {
        acknowledged.add(item.eventId);
      }
    }
    spool.ack([...acknowledged]);
    console.log(
      `[gateway] flushed ${result.results.length} event(s): accepted=${result.accepted} duplicates=${result.duplicates} rejected=${result.rejected}; spool=${spool.size()}`,
    );
    return { sent: result.results.length, remaining: spool.size() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[gateway] cloud unreachable (${message}); keeping ${spool.size()} event(s) buffered`);
    return { sent: 0, remaining: spool.size() };
  }
}

async function reportCloudError(code: string, message: string, detail?: string) {
  try {
    await client.reportError(code, message, detail);
  } catch {
    console.warn(`[gateway] could not report error ${code}`);
  }
}

async function pollOnce() {
  try {
    const events: GatewayEvent[] = await adapter.poll();
    const added = spool.enqueue(events);
    if (added > 0) console.log(`[gateway] adapter produced ${added} event(s); spool=${spool.size()}`);
    await flush();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[gateway] poll failed: ${message}`);
    await reportCloudError('ADAPTER_POLL_FAILED', message);
  }
}

async function heartbeat() {
  try {
    const beat = await client.heartbeat(FIRMWARE, spool.size());
    console.log(`[gateway] heartbeat ok; server=${beat.serverTime}; buffered=${spool.size()}`);
  } catch (error) {
    console.warn(`[gateway] heartbeat failed: ${error instanceof Error ? error.message : error}`);
  }
}

async function main() {
  console.log('[gateway] starting local hardware gateway');
  console.log(`[gateway] adapter: ${adapter.protocol} (${adapter.vendor}); API: ${API_URL}`);
  console.log('[gateway] NOTE: simulator data only — no physical dispenser is connected.');
  try {
    await adapter.connect();
  } catch (error) {
    console.error(`[gateway] adapter connection failed: ${error instanceof Error ? error.message : error}`);
    await reportCloudError('ADAPTER_CONNECT_FAILED', 'Adapter could not connect', String(error));
    process.exit(2);
  }
  const nozzles = await adapter.discoverNozzles();
  console.log(`[gateway] discovered ${nozzles.length} nozzle(s):`, nozzles.map((n) => `${n.dispenserCode}-${n.nozzleNumber}`).join(', '));

  await heartbeat();
  await pollOnce();

  const pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
  const heartbeatTimer = setInterval(heartbeat, HEARTBEAT_INTERVAL_MS);
  const flushTimer = setInterval(flush, Math.min(POLL_INTERVAL_MS, 15_000));

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[gateway] ${signal} received — flushing spool before exit (${spool.size()} buffered)`);
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
    clearInterval(flushTimer);
    await flush();
    await adapter.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (error) => {
  console.error('[gateway] fatal:', error);
  process.exit(1);
});
