import { get } from '../db/index.js';
import { nowIso } from './time.js';

export interface EffectivePrice {
  id: string;
  rate: string;
  effectiveFrom: string;
  stationId: string | null;
  note: string | null;
}

/**
 * Resolve the price effective at a point in time.
 *
 * A station-specific price always wins over a tenant-wide price; the most recent
 * `effective_from` wins within the same scope. History is never overwritten —
 * price changes insert a new row and close the previous open-ended period.
 */
export function priceAt(
  tenantId: string,
  productId: string,
  stationId: string | null | undefined,
  at: string = nowIso(),
): EffectivePrice | null {
  const row = stationId
    ? get<Record<string, unknown>>(
        `SELECT * FROM fuel_prices
          WHERE tenant_id = ? AND product_id = ? AND station_id = ?
            AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
          ORDER BY effective_from DESC LIMIT 1`,
        [tenantId, productId, stationId, at, at],
      )
    : undefined;
  const tenantPrice =
    row ??
    get<Record<string, unknown>>(
      `SELECT * FROM fuel_prices
        WHERE tenant_id = ? AND product_id = ? AND station_id IS NULL
          AND effective_from <= ? AND (effective_to IS NULL OR effective_to > ?)
        ORDER BY effective_from DESC LIMIT 1`,
      [tenantId, productId, at, at],
    );
  if (!tenantPrice) return null;
  return {
    id: String(tenantPrice.id),
    rate: String(tenantPrice.rate_per_litre),
    effectiveFrom: String(tenantPrice.effective_from),
    stationId: (tenantPrice.station_id as string | null) ?? null,
    note: (tenantPrice.note as string | null) ?? null,
  };
}
