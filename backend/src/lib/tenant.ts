import { all, get } from '../db/index.js';
import { forbidden, notFound, unprocessable } from './errors.js';
import type { AuthContext } from './auth.js';

export interface StationRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  status: string;
  [key: string]: unknown;
}

/** Tenant id for the authenticated user. Platform admins have no tenant scope. */
export function tenantIdOf(auth: AuthContext | undefined): string {
  if (!auth) throw forbidden('Authentication required');
  if (!auth.tenantId) {
    throw forbidden('Platform administrators cannot access organization data through station endpoints');
  }
  return auth.tenantId;
}

/**
 * Load a station inside the caller's tenant and verify station-level access.
 * Every station-scoped query must go through this helper: client-supplied
 * station ids are never trusted on their own.
 */
export function getStationOrThrow(auth: AuthContext, stationId: string): StationRow {
  if (!stationId) throw unprocessable('stationId is required');
  const station = get<StationRow>('SELECT * FROM stations WHERE id = ?', [stationId]);
  if (!station) throw notFound('Station not found');
  if (station.tenant_id !== tenantIdOf(auth)) throw notFound('Station not found');
  if (!auth.allStations && !auth.stationIds.has(station.id)) {
    throw forbidden('You do not have access to this station');
  }
  return station;
}

export function accessibleStationIds(auth: AuthContext): string[] {
  const tenantId = tenantIdOf(auth);
  if (auth.allStations) {
    return all<{ id: string }>('SELECT id FROM stations WHERE tenant_id = ?', [tenantId]).map((r) => r.id);
  }
  return [...auth.stationIds];
}

export function stationPlaceholders(ids: string[]): string {
  return ids.length > 0 ? ids.map(() => '?').join(',') : "''";
}

/**
 * Resolve the station filter for a list endpoint. When the client supplies a
 * stationId it must be accessible; otherwise the query is restricted to the
 * caller's accessible stations.
 */
export function resolveStationScope(
  auth: AuthContext,
  requested: string | null | undefined,
): { clause: string; params: string[] } {
  if (requested) {
    const station = getStationOrThrow(auth, requested);
    return { clause: 'AND station_id = ?', params: [station.id] };
  }
  if (auth.allStations) {
    return { clause: `AND station_id IN (SELECT id FROM stations WHERE tenant_id = ?)`, params: [tenantIdOf(auth)] };
  }
  const ids = accessibleStationIds(auth);
  return { clause: `AND station_id IN (${stationPlaceholders(ids)})`, params: ids };
}
