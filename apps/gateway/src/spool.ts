import fs from 'node:fs';
import path from 'node:path';
import type { GatewayEvent } from './types.js';

/**
 * Durable local spool for events that could not be acknowledged by the cloud.
 * Events are appended as NDJSON before transmission, so a gateway power cycle
 * or ISP outage never loses a reading. The cloud deduplicates by eventId, so
 * replay is safe.
 */
export class EventSpool {
  private events: GatewayEvent[] = [];
  private loaded = false;

  constructor(private filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    if (!fs.existsSync(this.filePath)) return;
    const lines = fs.readFileSync(this.filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        this.events.push(JSON.parse(line) as GatewayEvent);
      } catch {
        // Skip corrupt lines — a partially written record is retried by the device.
      }
    }
  }

  private persist() {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, this.events.map((e) => JSON.stringify(e)).join('\n') + (this.events.length ? '\n' : ''));
    fs.renameSync(tmp, this.filePath);
  }

  enqueue(events: GatewayEvent[]) {
    this.load();
    const existing = new Set(this.events.map((e) => e.eventId));
    let added = 0;
    for (const event of events) {
      if (existing.has(event.eventId)) continue;
      this.events.push(event);
      existing.add(event.eventId);
      added += 1;
    }
    if (added > 0) this.persist();
    return added;
  }

  peek(limit = 100): GatewayEvent[] {
    this.load();
    return this.events.slice(0, limit);
  }

  ack(eventIds: string[]) {
    this.load();
    const acked = new Set(eventIds);
    const before = this.events.length;
    this.events = this.events.filter((e) => !acked.has(e.eventId));
    if (this.events.length !== before) this.persist();
  }

  size() {
    this.load();
    return this.events.length;
  }

  clear() {
    this.events = [];
    this.loaded = true;
    this.persist();
  }
}
