import { randomUUID } from 'node:crypto';

/** Prefixed, URL-safe identifiers: `stn_3f0c…` — readable in logs and API payloads. */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function newIdCompact(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
