import { all, get } from '../db/index.js';

/**
 * Read the most specific setting available (station → tenant → default).
 * Settings are an allow-list: unknown keys are never read or written.
 */
export function settingsValue(
  key: string,
  tenantId: string | null | undefined,
  stationId: string | null | undefined,
  fallback: number,
): number;
export function settingsValue(
  key: string,
  tenantId: string | null | undefined,
  stationId: string | null | undefined,
  fallback: string,
): string;
export function settingsValue(
  key: string,
  tenantId: string | null | undefined,
  stationId: string | null | undefined,
  fallback: boolean,
): boolean;
export function settingsValue(
  key: string,
  tenantId: string | null | undefined,
  stationId: string | null | undefined,
  fallback: number | string | boolean,
): number | string | boolean {
  const row = get<{ value: string | null }>(
    `SELECT value FROM app_settings
      WHERE key = ? AND tenant_id IN (?, '') AND station_id IN (?, '')
      ORDER BY (tenant_id != '') DESC, (station_id != '') DESC LIMIT 1`,
    [key, tenantId ?? '', stationId ?? ''],
  );
  if (!row || row.value === null || row.value === '') return fallback;
  if (typeof fallback === 'boolean') {
    return ['1', 'true', 'yes', 'on'].includes(row.value.toLowerCase());
  }
  if (typeof fallback === 'number') {
    const n = Number(row.value);
    return Number.isFinite(n) ? n : fallback;
  }
  return row.value;
}

export function settingsMap(tenantId: string, stationId: string | null): Record<string, string> {
  const rows = all<{ key: string; value: string }>(
    'SELECT key, value FROM app_settings WHERE tenant_id = ? AND station_id = ?',
    [tenantId, stationId ?? ''],
  );
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}
