import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../env.js';
import { all, get, run, shape, shapeAll, tx, type Row } from '../db/index.js';
import { asyncHandler, created, ok, pageMeta, paging, parse, sortClause } from '../lib/http.js';
import { badRequest, forbidden, notFound, unauthorized, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, resolveStationScope, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { deviceKeyPrefix, generateDeviceKey, sha256 } from '../lib/security.js';
import { D, money, rate as fmtRate } from '../lib/decimal.js';
import { priceAt } from '../lib/pricing.js';
import { evaluateReading, latestCountableReading, type ReadingEvaluation } from '../lib/meter.js';
import { settingsValue } from '../lib/settings.js';
import { logger } from '../lib/logger.js';

export const hardwareRouter = Router();
export const deviceRouter = hardwareRouter;

const DEVICE_ONLINE_WINDOW_MINUTES = env.DEVICE_ONLINE_WINDOW_MINUTES;

// ------------------------------------------------------------------ helpers

interface DeviceRow {
  id: string;
  tenant_id: string;
  station_id: string;
  code: string;
  name: string;
  type: string;
  serial_number: string | null;
  vendor: string | null;
  model: string | null;
  protocol: string | null;
  status: string;
  last_heartbeat_at: string | null;
  last_sync_at: string | null;
  is_simulated: number;
  notes: string | null;
}

function isOnline(lastHeartbeatAt: string | null) {
  if (!lastHeartbeatAt) return false;
  return Date.now() - new Date(lastHeartbeatAt).getTime() < DEVICE_ONLINE_WINDOW_MINUTES * 60_000;
}

function deviceView(row: DeviceRow) {
  const lastEvent = get<{ received_at: string }>(
    'SELECT received_at FROM device_events WHERE device_id = ? ORDER BY received_at DESC LIMIT 1',
    [row.id],
  );
  const pending = get<{ count: number }>(
    "SELECT COUNT(*) AS count FROM device_events WHERE device_id = ? AND status IN ('RECEIVED','ERROR')",
    [row.id],
  );
  const publicDevice = shape(row as unknown as Row) as Record<string, unknown>;
  delete publicDevice.apiKeyHash;
  return {
    ...publicDevice,
    online: row.status !== 'DISABLED' && isOnline(row.last_heartbeat_at),
    lastEventAt: lastEvent?.received_at ?? null,
    pendingEvents: pending?.count ?? 0,
  };
}

/** Authenticate a gateway using its `x-device-key` header. */
export function authenticateDevice(req: import('express').Request): DeviceRow {
  const key = req.header('x-device-key');
  if (!key || key.length < 20) throw unauthorized('Missing or malformed device key');
  const hash = sha256(key);
  const device = get<DeviceRow>('SELECT * FROM hardware_devices WHERE api_key_hash = ?', [hash]);
  if (!device) throw unauthorized('Invalid device key');
  if (device.status === 'DISABLED') throw forbidden('This device has been disabled');
  const tenant = get<{ status: string }>('SELECT status FROM tenants WHERE id = ?', [device.tenant_id]);
  if (!tenant || tenant.status !== 'ACTIVE') throw forbidden('The organization is suspended');
  const station = get<{ status: string }>('SELECT status FROM stations WHERE id = ?', [device.station_id]);
  if (!station || station.status !== 'ACTIVE') throw forbidden('The station is inactive');
  return device;
}

function maxJumpLitres(tenantId: string, stationId: string) {
  return settingsValue('hardware.maxJumpLitres', tenantId, stationId, 10000);
}

function maxNozzleTotalizer(nozzleId: string) {
  const row = get<{ max_value: string | null }>(
    'SELECT MAX(CAST(reading_value AS REAL)) AS max_value FROM meter_readings WHERE nozzle_id = ?',
    [nozzleId],
  );
  return row?.max_value == null ? null : Number(row.max_value);
}

interface ResolvedNozzle {
  nozzleId: string;
  stationId: string;
  tenantId: string;
  productId: string;
  label: string;
  dispenserId: string;
}

function resolveNozzle(
  tenantId: string,
  stationId: string,
  dispenserCode: string | undefined,
  nozzleNumber: number | undefined,
): ResolvedNozzle {
  if (!dispenserCode) throw unprocessable('Event payload is missing dispenserCode');
  if (!nozzleNumber) throw unprocessable('Event payload is missing nozzleNumber');
  const row = get<Record<string, unknown>>(
    `SELECT n.id, n.station_id, n.product_id, n.label, n.dispenser_id, s.tenant_id, d.status AS dispenser_status
       FROM nozzles n
       JOIN dispensers d ON d.id = n.dispenser_id
       JOIN stations s ON s.id = n.station_id
      WHERE d.code = ? AND d.station_id = ? AND n.number = ?`,
    [dispenserCode, stationId, nozzleNumber],
  );
  if (!row) throw unprocessable(`Unknown nozzle: dispenser ${dispenserCode} / nozzle ${nozzleNumber}`);
  if (String(row.tenant_id) !== tenantId) throw unprocessable('Nozzle belongs to another organization');
  if (String(row.dispenser_status) !== 'ACTIVE') throw unprocessable('Dispenser is not active');
  return {
    nozzleId: String(row.id),
    stationId: String(row.station_id),
    tenantId: String(row.tenant_id),
    productId: String(row.product_id),
    label: String(row.label),
    dispenserId: String(row.dispenser_id),
  };
}

function stockTankForProduct(stationId: string, productId: string) {
  return get<{ id: string; code: string }>(
    "SELECT id, code FROM tanks WHERE station_id = ? AND product_id = ? AND status = 'ACTIVE' ORDER BY code LIMIT 1",
    [stationId, productId],
  );
}

// ------------------------------------------------------------------ devices

hardwareRouter.get(
  '/devices',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    let rows: DeviceRow[];
    if (stationId) {
      getStationOrThrow(auth, stationId);
      rows = all<DeviceRow>('SELECT * FROM hardware_devices WHERE station_id = ? ORDER BY name', [stationId]);
    } else if (auth.allStations) {
      rows = all<DeviceRow>('SELECT * FROM hardware_devices WHERE tenant_id = ? ORDER BY name', [tenantIdOf(auth)]);
    } else {
      const ids = [...auth.stationIds];
      rows = all<DeviceRow>(
        `SELECT * FROM hardware_devices WHERE station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"}) ORDER BY name`,
        ids,
      );
    }
    return ok(res, rows.map(deviceView));
  }),
);

hardwareRouter.post(
  '/devices',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        code: z.string().min(2).max(40),
        name: z.string().min(2).max(100),
        type: z.enum(['GATEWAY', 'CONTROLLER']).optional(),
        isSimulated: z.boolean().optional(),
        vendor: z.string().max(80).optional().nullable(),
        model: z.string().max(80).optional().nullable(),
        serialNumber: z.string().max(80).optional().nullable(),
        protocol: z.string().max(80).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    if (get('SELECT id FROM hardware_devices WHERE code = ?', [body.code])) {
      throw unprocessable('Device code already exists');
    }
    const key = generateDeviceKey();
    const id = newId('dev');
    tx(() => {
      run(
        `INSERT INTO hardware_devices
          (id, tenant_id, station_id, code, name, type, vendor, model, serial_number, protocol, status,
           api_key_hash, api_key_prefix, key_version, is_simulated, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OFFLINE', ?, ?, 1, ?, ?, ?, ?)`,
        [id, station.tenant_id, station.id, body.code, body.name, body.type ?? 'GATEWAY',
          body.vendor ?? null, body.model ?? null, body.serialNumber ?? null, body.protocol ?? null,
          key.secretHash, key.prefix, body.isSimulated ? 1 : 0, body.notes ?? null, nowIso(), nowIso()],
      );
      run(
        `INSERT INTO device_credentials (id, device_id, key_prefix, secret_hash, version, status, created_by, created_at)
         VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?, ?)`,
        [newId('dcd'), id, key.prefix, key.secretHash, auth.user.id, nowIso()],
      );
    });
    audit(req, {
      action: 'DEVICE_REGISTERED', entity: 'HardwareDevice', entityId: id, stationId: station.id,
      summary: `${body.name} (${body.code}) registered with credential version 1`,
    });
    return created(res, {
      ...deviceView(get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ?', [id])!),
      // Plaintext is returned exactly once and is never persisted.
      apiKey: key.key,
      warning: 'Store this key on the gateway host now — it cannot be retrieved again. Rotate it if lost.',
    });
  }),
);

hardwareRouter.patch(
  '/devices/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.write')) throw forbidden();
    const device = get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ? AND tenant_id = ?', [req.params.id, tenantIdOf(auth)]);
    if (!device) throw notFound('Device not found');
    getStationOrThrow(auth, device.station_id);
    const body = parse(
      z.object({
        name: z.string().min(2).max(100).optional(),
        notes: z.string().max(500).optional().nullable(),
        status: z.enum(['ONLINE', 'OFFLINE', 'DISABLED']).optional(),
      }),
      req.body,
    );
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
    if (body.notes !== undefined) { sets.push('notes = ?'); params.push(body.notes); }
    if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status); }
    if (sets.length > 0) {
      sets.push('updated_at = ?');
      run(`UPDATE hardware_devices SET ${sets.join(', ')} WHERE id = ?`, [...params, nowIso(), device.id]);
    }
    audit(req, {
      action: body.status === 'DISABLED' ? 'DEVICE_DISABLED' : 'DEVICE_UPDATED',
      entity: 'HardwareDevice', entityId: device.id, stationId: device.station_id,
      summary: `${device.code}: ${body.status ? `status → ${body.status}` : 'details updated'}`,
      before: { status: device.status, name: device.name }, after: body,
    });
    return ok(res, deviceView(get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ?', [device.id])!));
  }),
);

hardwareRouter.post(
  '/devices/:id/rotate-key',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.write')) throw forbidden();
    const device = get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ? AND tenant_id = ?', [req.params.id, tenantIdOf(auth)]);
    if (!device) throw notFound('Device not found');
    getStationOrThrow(auth, device.station_id);
    if (device.status === 'DISABLED') throw unprocessable('Re-enable the device before rotating its key');
    const key = generateDeviceKey();
    const version = Number(get<{ key_version: number }>('SELECT key_version FROM hardware_devices WHERE id = ?', [device.id])?.key_version ?? 1) + 1;
    tx(() => {
      run(
        "UPDATE device_credentials SET status = 'ROTATED', rotated_at = ? WHERE device_id = ? AND status = 'ACTIVE'",
        [nowIso(), device.id],
      );
      run(
        'UPDATE hardware_devices SET api_key_hash = ?, api_key_prefix = ?, key_version = ?, updated_at = ? WHERE id = ?',
        [key.secretHash, key.prefix, version, nowIso(), device.id],
      );
      run(
        `INSERT INTO device_credentials (id, device_id, key_prefix, secret_hash, version, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
        [newId('dcd'), device.id, key.prefix, key.secretHash, version, auth.user.id, nowIso()],
      );
    });
    audit(req, {
      action: 'DEVICE_KEY_ROTATED', entity: 'HardwareDevice', entityId: device.id, stationId: device.station_id,
      summary: `Credential version ${version} issued; previous version revoked`,
    });
    return ok(res, { apiKey: key.key, keyVersion: version, warning: 'Update the gateway configuration before its next heartbeat.' });
  }),
);

hardwareRouter.get(
  '/devices/:id/events',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.read')) throw forbidden();
    const device = get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ? AND tenant_id = ?', [req.params.id, tenantIdOf(auth)]);
    if (!device) throw notFound('Device not found');
    getStationOrThrow(auth, device.station_id);
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['device_id = ?'];
    const params: (string | number)[] = [device.id];
    if (typeof req.query.status === 'string' && req.query.status) {
      clauses.push('status = ?');
      params.push(req.query.status);
    }
    const where = clauses.join(' AND ');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM device_events WHERE ${where}`, params)?.count ?? 0;
    const rows = all(
      `SELECT * FROM device_events WHERE ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows, ['payload']), pageMeta(total, p));
  }),
);

hardwareRouter.post(
  '/devices/:id/events/:eventId/replay',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.write')) throw forbidden();
    const device = get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ? AND tenant_id = ?', [req.params.id, tenantIdOf(auth)]);
    if (!device) throw notFound('Device not found');
    getStationOrThrow(auth, device.station_id);
    const event = get<Record<string, unknown>>(
      'SELECT * FROM device_events WHERE device_id = ? AND event_id = ?',
      [device.id, req.params.eventId],
    );
    if (!event) throw notFound('Event not found');
    if (String(event.status) === 'PROCESSED') {
      return ok(res, { replayed: false, reason: 'Event already processed' });
    }
    const result = processEvent(device, event);
    audit(req, {
      action: 'DEVICE_EVENT_REPLAYED', entity: 'DeviceEvent', entityId: String(event.id),
      stationId: device.station_id, summary: `Replay of ${String(event.event_id)}: ${result.status}`,
    });
    return ok(res, result);
  }),
);

hardwareRouter.get(
  '/hardware/diagnostics',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    const tenantId = tenantIdOf(auth);
    const scope = resolveStationScope(auth, stationId);
    const params = [tenantId, ...scope.params];

    const devices = all<DeviceRow>(
      `SELECT * FROM hardware_devices WHERE tenant_id = ? ${scope.clause} ORDER BY name`,
      params,
    );
    const eventCounts = all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) AS count FROM device_events WHERE tenant_id = ? ${scope.clause} GROUP BY status`,
      params,
    );
    const qualityCounts = all<{ quality: string; count: number }>(
      `SELECT quality, COUNT(*) AS count FROM meter_readings WHERE tenant_id = ? ${scope.clause} GROUP BY quality`,
      params,
    );
    const errors = all(
      `SELECT * FROM device_error_logs WHERE station_id IN (SELECT id FROM stations WHERE tenant_id = ?) ${scope.clause}
        ORDER BY created_at DESC LIMIT 25`,
      params,
    );
    const lastEvent = get<{ received_at: string }>(
      `SELECT received_at FROM device_events WHERE tenant_id = ? ${scope.clause} ORDER BY received_at DESC LIMIT 1`,
      params,
    );
    return ok(res, {
      serverTime: nowIso(),
      onlineWindowMinutes: DEVICE_ONLINE_WINDOW_MINUTES,
      devices: devices.map(deviceView),
      eventCounts: Object.fromEntries(eventCounts.map((r) => [r.status, r.count])),
      qualityCounts: Object.fromEntries(qualityCounts.map((r) => [r.quality, r.count])),
      recentErrors: shapeAll(errors),
      lastEventAt: lastEvent?.received_at ?? null,
      adapterContract: {
        version: '1.0.0',
        inboundAuth: 'x-device-key header (opaque key, sha256-hashed at rest)',
        eventTypes: ['TOTALIZER_SNAPSHOT', 'TRANSACTION'],
        idempotency: 'unique (device_id, event_id); duplicate deliveries are reported, not reprocessed',
      },
      realHardwareVerified: false,
      disclaimer:
        'No real dispenser/forecourt controller has been connected. Adapters and the simulator implement an ' +
        'internal contract only; production integration requires a vendor-documented protocol.',
    });
  }),
);

// ------------------------------------------------------------------ readings

hardwareRouter.get(
  '/readings',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'readings.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['r.tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) {
      getStationOrThrow(auth, stationId);
      clauses.push('r.station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`r.station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
      params.push(...ids);
    }
    if (typeof req.query.nozzleId === 'string' && req.query.nozzleId) {
      clauses.push('r.nozzle_id = ?');
      params.push(req.query.nozzleId);
    }
    if (typeof req.query.quality === 'string' && req.query.quality) {
      clauses.push('r.quality = ?');
      params.push(req.query.quality);
    }
    if (typeof req.query.from === 'string' && req.query.from) {
      clauses.push('r.reading_at >= ?');
      params.push(req.query.from);
    }
    const where = clauses.join(' AND ');
    const order = sortClause(req.query as Record<string, unknown>, { readingAt: 'r.reading_at' }, 'r.reading_at DESC');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM meter_readings r WHERE ${where}`, params)?.count ?? 0;
    const rows = all(
      `SELECT r.*, n.label AS nozzle_label, d.code AS dispenser_code, p.name AS product_name,
              hd.name AS device_name, hd.code AS device_code
         FROM meter_readings r
         JOIN nozzles n ON n.id = r.nozzle_id
         JOIN dispensers d ON d.id = n.dispenser_id
         JOIN fuel_products p ON p.id = n.product_id
         LEFT JOIN hardware_devices hd ON hd.id = r.device_id
        WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

hardwareRouter.post(
  '/readings/manual',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'readings.manual')) throw forbidden();
    if (!settingsValue('hardware.allowManualFallback', tenantIdOf(auth), null, 1)) {
      throw forbidden('Manual reading capture is disabled in station settings');
    }
    const body = parse(
      z.object({
        nozzleId: z.string().min(3),
        readingValue: z.union([z.string(), z.number()]).transform(String),
        unit: z.string().max(8).optional(),
        readingAt: z.string().datetime().optional(),
        note: z.string().max(300).optional(),
        shiftId: z.string().optional().nullable(),
      }),
      req.body,
    );
    const nozzle = get<Record<string, unknown>>('SELECT * FROM nozzles WHERE id = ?', [body.nozzleId]);
    if (!nozzle) throw notFound('Nozzle not found');
    const station = getStationOrThrow(auth, String(nozzle.station_id));
    const previous = latestCountableReading(String(nozzle.id));
    const value = fmtRate(D(body.readingValue));
    if (D(value).lt(0)) throw unprocessable('Reading cannot be negative');
    const readingAt = body.readingAt ?? nowIso();
    const evaluation = evaluateReading({ value, unit: body.unit ?? 'L', readingAt }, previous, {
      maxJumpLitres: maxJumpLitres(station.tenant_id, station.id),
    });
    const id = newId('rdg');
    tx(() => {
      run(
        `INSERT INTO meter_readings
          (id, tenant_id, station_id, nozzle_id, reading_value, unit, quality, source, reading_at,
           sequence, delta_litres, previous_reading_id, is_countable, is_simulated, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'MANUAL', ?, 0, ?, ?, ?, 0, ?, ?, ?)`,
        [id, station.tenant_id, station.id, nozzle.id, value, body.unit ?? 'L', evaluation.quality,
          readingAt, evaluation.delta?.toFixed(3) ?? null, previous?.id ?? null, evaluation.countable ? 1 : 0,
          body.note ?? evaluation.reason ?? null, auth.user.id, nowIso()],
      );
    });
    audit(req, {
      action: 'MANUAL_READING_CAPTURED', entity: 'MeterReading', entityId: id, stationId: station.id,
      summary: `${nozzle.label}: ${value} ${body.unit ?? 'L'} recorded manually (${evaluation.quality})`,
      after: evaluation,
    });
    return created(res, { ...(shape(get('SELECT * FROM meter_readings WHERE id = ?', [id])) as Record<string, unknown>), evaluation });
  }),
);

// ------------------------------------------------------- gateway ingestion

const snapshotPayload = z.object({
  dispenserCode: z.string().min(1),
  nozzleNumber: z.coerce.number().int().min(1).max(99),
  totalizer: z.union([z.string(), z.number()]).transform(String),
  unit: z.string().max(8).default('L'),
  readingAt: z.string().datetime().optional(),
  sequence: z.coerce.number().int().min(0).optional(),
});

const transactionPayload = z.object({
  dispenserCode: z.string().min(1),
  nozzleNumber: z.coerce.number().int().min(1).max(99),
  litres: z.union([z.string(), z.number()]).transform(String),
  unitPrice: z.union([z.string(), z.number()]).transform(String).optional(),
  paymentMode: z.enum(['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT']).optional(),
  occurredAt: z.string().datetime().optional(),
  sequence: z.coerce.number().int().min(0).optional(),
  reference: z.string().max(80).optional(),
});

const eventSchema = z
  .object({
    eventId: z.string().min(6).max(120),
    type: z.enum(['TOTALIZER_SNAPSHOT', 'TRANSACTION']),
    occurredAt: z.string().datetime().optional(),
    sequence: z.coerce.number().int().min(0).optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

interface ProcessResult {
  eventId: string;
  status: 'PROCESSED' | 'REJECTED' | 'ERROR';
  readingId?: string;
  quality?: string;
  countable?: boolean;
  reason?: string;
}

function processEvent(device: DeviceRow, event: Record<string, unknown>): ProcessResult {
  const eventId = String(event.event_id ?? event.eventId);
  const eventType = String(event.event_type ?? event.type);
  try {
    const raw = event.payload;
    let payload: Record<string, unknown> =
      typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>);
    // Gateways may send the event body flat (top-level dispenserCode/value…).
    payload = {
      ...payload,
      dispenserCode: payload.dispenserCode ?? payload.dispenser_code,
      nozzleNumber: payload.nozzleNumber ?? payload.nozzle_number,
      totalizer: payload.totalizer ?? payload.value,
      unit: payload.unit ?? 'L',
      readingAt: payload.readingAt ?? payload.readingAt ?? event.occurred_at,
      litres: payload.litres ?? payload.quantity_litres ?? payload.quantityLitres,
      unitPrice: payload.unitPrice ?? payload.unit_price,
      paymentMode: payload.paymentMode ?? payload.payment_mode,
      occurredAt: payload.occurredAt ?? event.occurred_at,
      sequence: payload.sequence ?? event.sequence,
    };
    if (eventType === 'TOTALIZER_SNAPSHOT') {
      const parsed = snapshotPayload.parse(payload);
      const nozzle = resolveNozzle(device.tenant_id, device.station_id, parsed.dispenserCode, parsed.nozzleNumber);
      const previous = latestCountableReading(nozzle.nozzleId);
      const readingAt = parsed.readingAt ?? String(event.occurred_at ?? nowIso());
      const evaluation: ReadingEvaluation = evaluateReading(
        { value: fmtRate(D(parsed.totalizer)), unit: parsed.unit, readingAt },
        previous,
        {
          maxJumpLitres: maxJumpLitres(device.tenant_id, device.station_id),
          maxTotalizer: maxNozzleTotalizer(nozzle.nozzleId),
        },
      );
      const readingId = newId('rdg');
      tx(() => {
        run(
          `INSERT INTO meter_readings
            (id, tenant_id, station_id, nozzle_id, device_id, device_event_id, reading_value, unit, quality,
             source, reading_at, sequence, delta_litres, previous_reading_id, is_countable, is_simulated, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [readingId, nozzle.tenantId, nozzle.stationId, nozzle.nozzleId, device.id, String(event.id),
            fmtRate(D(parsed.totalizer)), parsed.unit, evaluation.quality,
            device.is_simulated ? 'SIMULATOR' : 'DEVICE', readingAt, parsed.sequence ?? Number(event.sequence ?? 0),
            evaluation.delta?.toFixed(3) ?? null, previous?.id ?? null, evaluation.countable ? 1 : 0, device.is_simulated ? 1 : 0,
            evaluation.reason ?? null, nowIso()],
        );
        run("UPDATE device_events SET status = 'PROCESSED', processed_at = ? WHERE id = ?", [nowIso(), String(event.id)]);
        run('UPDATE hardware_devices SET last_sync_at = ? WHERE id = ?', [nowIso(), device.id]);
      });
      return { eventId, status: 'PROCESSED', readingId, quality: evaluation.quality, countable: evaluation.countable };
    }

    if (eventType === 'TRANSACTION') {
      const parsed = transactionPayload.parse(payload);
      const nozzle = resolveNozzle(device.tenant_id, device.station_id, parsed.dispenserCode, parsed.nozzleNumber);
      const litres = D(parsed.litres);
      if (litres.lte(0)) throw unprocessable('Transaction litres must be greater than zero');
      if (litres.gt(5000)) throw unprocessable('Transaction litres exceed the per-transaction sanity limit');
      const priced = priceAt(nozzle.tenantId, nozzle.productId, nozzle.stationId);
      const rate = parsed.unitPrice ? D(parsed.unitPrice) : D(priced?.rate ?? 0);
      if (rate.lte(0)) throw unprocessable('No effective fuel price found for this product/station');
      const amount = litres.mul(rate);
      const occurredAt = parsed.occurredAt ?? String(event.occurred_at ?? nowIso());
      tx(() => {
        run(
          `INSERT INTO fuel_transactions
            (id, tenant_id, station_id, nozzle_id, product_id, quantity_litres, rate, amount, payment_mode,
             occurred_at, reference, source, is_estimated, is_demo, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DEVICE_TRANSACTION', 0, ?, ?)`,
          [newId('ftx'), nozzle.tenantId, nozzle.stationId, nozzle.nozzleId, nozzle.productId,
            fmtRate(litres), fmtRate(rate), money(amount), parsed.paymentMode ?? 'CASH', occurredAt,
            parsed.reference ?? `evt:${eventId}`, device.is_simulated ? 1 : 0, nowIso()],
        );
        run("UPDATE device_events SET status = 'PROCESSED', processed_at = ? WHERE id = ?", [nowIso(), String(event.id)]);
        run('UPDATE hardware_devices SET last_sync_at = ? WHERE id = ?', [nowIso(), device.id]);
      });
      // Stock is posted once, at shift close, from countable totalizer litres.
      // Posting a movement per transaction too would double count dispensed fuel.
      return { eventId, status: 'PROCESSED' };
    }

    throw unprocessable(`Unsupported event type: ${eventType}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown processing failure';
    const status = error instanceof Error && 'status' in error && Number((error as { status: number }).status) < 500
      ? 'REJECTED'
      : 'ERROR';
    run("UPDATE device_events SET status = ?, error = ?, processed_at = ? WHERE id = ?", [
      status, message.slice(0, 500), nowIso(), String(event.id),
    ]);
    try {
      run(
        `INSERT INTO device_error_logs (id, device_id, station_id, code, message, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [newId('der'), device.id, device.station_id, status === 'REJECTED' ? 'EVENT_REJECTED' : 'EVENT_ERROR',
          message.slice(0, 500), eventId, nowIso()],
      );
    } catch {
      /* keep ingestion resilient */
    }
    logger.warn({ eventId, device: device.code, status, message }, 'Device event processing failed');
    return { eventId, status, reason: message };
  }
}

hardwareRouter.post(
  '/gateway/events',
  asyncHandler((req, res) => {
    const device = authenticateDevice(req);
    const body = parse(
      z.object({
        events: z.array(eventSchema).min(1).max(200),
        gatewayVersion: z.string().max(40).optional(),
        bufferedMinutes: z.coerce.number().int().min(0).optional(),
      }),
      req.body,
    );
    const results: ProcessResult[] = [];
    let accepted = 0;
    let rejected = 0;
    let duplicates = 0;

    for (const event of body.events) {
      const occurredAt = event.occurredAt ?? nowIso();
      const payloadObject = event.payload ?? (event as Record<string, unknown>);
      const payloadText = JSON.stringify(payloadObject);
      const payloadHash = createHash('sha256').update(payloadText).digest('hex');
      const existing = get<{ id: string; status: string }>(
        'SELECT id, status FROM device_events WHERE device_id = ? AND event_id = ?',
        [device.id, event.eventId],
      );
      if (existing) {
        duplicates += 1;
        results.push({
          eventId: event.eventId,
          status: 'REJECTED',
          reason: `Duplicate of an event already ${existing.status.toLowerCase()}`,
        });
        continue;
      }
      const rawId = newId('dev');
      try {
        run(
          `INSERT INTO device_events
            (id, tenant_id, station_id, device_id, event_id, event_type, sequence, occurred_at, received_at,
             payload, payload_hash, status, source_ip)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?)`,
          [rawId, device.tenant_id, device.station_id, device.id, event.eventId, event.type,
            event.sequence ?? 0, occurredAt, nowIso(), payloadText, payloadHash, req.ip ?? null],
        );
      } catch {
        duplicates += 1;
        results.push({ eventId: event.eventId, status: 'REJECTED', reason: 'Duplicate event id' });
        continue;
      }
      const result = processEvent(device, {
        id: rawId,
        event_id: event.eventId,
        event_type: event.type,
        occurred_at: occurredAt,
        sequence: event.sequence ?? 0,
        payload: payloadText,
      });
      results.push(result);
      if (result.status === 'PROCESSED') accepted += 1;
      else rejected += 1;
    }

    run('UPDATE hardware_devices SET last_heartbeat_at = ?, status = ? WHERE id = ?', [
      nowIso(), 'ONLINE', device.id,
    ]);
    if (body.gatewayVersion) {
      run('UPDATE hardware_devices SET firmware_version = ? WHERE id = ?', [body.gatewayVersion, device.id]);
    }
    return ok(res, {
      device: device.code,
      accepted,
      rejected,
      duplicates,
      bufferedMinutes: body.bufferedMinutes ?? 0,
      results,
      serverTime: nowIso(),
    });
  }),
);

hardwareRouter.post(
  '/gateway/heartbeat',
  asyncHandler((req, res) => {
    const device = authenticateDevice(req);
    const body = parse(
      z.object({
        uptimeSeconds: z.coerce.number().int().min(0).optional(),
        queuedEvents: z.coerce.number().int().min(0).optional(),
        gatewayVersion: z.string().max(40).optional(),
        adapters: z.array(z.string().max(60)).max(20).optional(),
      }),
      req.body ?? {},
    );
    tx(() => {
      run('UPDATE hardware_devices SET last_heartbeat_at = ?, status = ?, updated_at = ? WHERE id = ?', [
        nowIso(), 'ONLINE', nowIso(), device.id,
      ]);
      if (body.gatewayVersion) {
        run('UPDATE hardware_devices SET firmware_version = ? WHERE id = ?', [body.gatewayVersion, device.id]);
      }
    });
    return ok(res, {
      acknowledged: true,
      device: device.code,
      serverTime: nowIso(),
      queuedHint: body.queuedEvents ?? 0,
      nextHeartbeatSeconds: 30,
    });
  }),
);

hardwareRouter.post(
  '/gateway/errors',
  asyncHandler((req, res) => {
    const device = authenticateDevice(req);
    const body = parse(
      z.object({
        errors: z
          .array(
            z.object({
              code: z.string().min(2).max(60),
              message: z.string().min(2).max(500),
              detail: z.string().max(2000).optional().nullable(),
              occurredAt: z.string().datetime().optional(),
            }),
          )
          .min(1)
          .max(50),
      }),
      req.body,
    );
    tx(() => {
      for (const error of body.errors) {
        run(
          `INSERT INTO device_error_logs (id, device_id, station_id, code, message, detail, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [newId('der'), device.id, device.station_id, error.code, error.message,
            error.detail ?? null, error.occurredAt ?? nowIso()],
        );
      }
      run('UPDATE hardware_devices SET last_heartbeat_at = ? WHERE id = ?', [nowIso(), device.id]);
    });
    return ok(res, { stored: body.errors.length });
  }),
);

// --------------------------------------------------------- simulator (demo)

hardwareRouter.post(
  '/demo/simulate',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'devices.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        deviceId: z.string().min(3).optional(),
        dispenserCode: z.string().max(40).optional(),
        nozzleNumber: z.coerce.number().int().min(1).max(99).optional(),
        litres: z.union([z.string(), z.number()]).transform(String).optional(),
        events: z.coerce.number().int().min(1).max(5).optional(),
      }),
      req.body,
    );
    getStationOrThrow(auth, body.stationId);
    const device = body.deviceId
      ? get<DeviceRow>('SELECT * FROM hardware_devices WHERE id = ? AND station_id = ?', [body.deviceId, body.stationId])
      : get<DeviceRow>(
          "SELECT * FROM hardware_devices WHERE station_id = ? AND status != 'DISABLED' ORDER BY is_simulated DESC, created_at LIMIT 1",
          [body.stationId],
        );
    if (!device) throw notFound('No gateway device registered for this station');
    if (!device.is_simulated) throw unprocessable('Simulated readings require a simulated device');
    if (!env.ENABLE_DEMO_TOOLS) throw forbidden('Demo tools are disabled in this environment');

    const nozzle = get<Record<string, unknown>>(
      `SELECT n.id, n.number, n.label, n.product_id, d.code AS dispenser_code, d.station_id
         FROM nozzles n JOIN dispensers d ON d.id = n.dispenser_id
        WHERE d.station_id = ? ${body.dispenserCode ? 'AND d.code = ?' : ''}
        ORDER BY d.code, n.number LIMIT 1`,
      body.dispenserCode ? [body.stationId, body.dispenserCode] : [body.stationId],
    );
    if (!nozzle) throw notFound('No nozzles configured for simulation');

    const count = body.events ?? 1;
    // Continue from the highest totalizer ever recorded for this nozzle so the
    // simulated stream stays monotonic even after seeded history.
    const last = get<{ max_value: string | null }>(
      'SELECT MAX(CAST(reading_value AS REAL)) AS max_value FROM meter_readings WHERE nozzle_id = ?',
      [String(nozzle.id)],
    );
    let totalizer = D(last?.max_value ?? 0);
    const generated: { eventId: string; type: string; totalizer: string }[] = [];
    for (let i = 0; i < count; i += 1) {
      const litres = D(body.litres ?? String(5 + Math.round(Math.random() * 250) / 10));
      totalizer = totalizer.plus(litres);
      const eventId = `sim-${Date.now()}-${i}-${randomUUID().slice(0, 8)}`;
      const payloadText = JSON.stringify({
        dispenserCode: String(nozzle.dispenser_code),
        nozzleNumber: Number(nozzle.number),
        totalizer: totalizer.toFixed(3),
        unit: 'L',
        readingAt: nowIso(),
        sequence: Date.now() + i,
      });
      const rawId = newId('dev');
      run(
        `INSERT INTO device_events
          (id, tenant_id, station_id, device_id, event_id, event_type, sequence, occurred_at, received_at,
           payload, payload_hash, status, source_ip)
         VALUES (?, ?, ?, ?, ?, 'TOTALIZER_SNAPSHOT', ?, ?, ?, ?, ?, 'RECEIVED', 'simulator')`,
        [rawId, device.tenant_id, device.station_id, device.id, eventId, Date.now() + i, nowIso(), nowIso(),
          payloadText, createHash('sha256').update(payloadText).digest('hex')],
      );
      processEvent(device, {
        id: rawId, event_id: eventId, event_type: 'TOTALIZER_SNAPSHOT',
        occurred_at: nowIso(), sequence: Date.now() + i, payload: payloadText,
      });
      generated.push({ eventId, type: 'TOTALIZER_SNAPSHOT', totalizer: totalizer.toFixed(3) });
    }
    run('UPDATE hardware_devices SET last_heartbeat_at = ?, status = ?, last_sync_at = ? WHERE id = ?', [
      nowIso(), 'ONLINE', nowIso(), device.id,
    ]);
    audit(req, {
      action: 'SIMULATED_EVENTS_GENERATED', entity: 'HardwareDevice', entityId: device.id,
      stationId: device.station_id, summary: `${generated.length} SIMULATED events injected on ${device.code}`,
      isDemo: true,
    });
    return created(res, {
      simulated: true,
      deviceId: device.id,
      deviceCode: device.code,
      nozzle: { id: nozzle.id, label: nozzle.label, number: nozzle.number },
      generated,
      warning: 'These events are synthetically generated. They are labelled SIMULATED and must not be treated as meter data from real hardware.',
    });
  }),
);
