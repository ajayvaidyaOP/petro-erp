import fs from 'node:fs';
import os from 'node:os';
import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, ok, parse } from '../lib/http.js';
import { forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { env } from '../env.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { D } from '../lib/decimal.js';
import { settingsValue } from '../lib/settings.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const ALLOWED_KEYS: Record<
  string,
  { type: 'number' | 'boolean' | 'string'; min?: number; max?: number; label: string; description: string; scope: string }
> = {
  'hardware.maxJumpLitres': {
    type: 'number', min: 100, max: 100000,
    label: 'Maximum believable jump (litres)',
    description: 'A totalizer increase larger than this between two readings is flagged as suspicious and excluded from counted litres.',
    scope: 'station',
  },
  'hardware.heartbeatTimeoutMinutes': {
    type: 'number', min: 1, max: 120,
    label: 'Heartbeat timeout (minutes)',
    description: 'A gateway with no heartbeat within this window is reported offline.',
    scope: 'station',
  },
  'hardware.allowManualFallback': {
    type: 'boolean',
    label: 'Allow manual reading fallback',
    description: 'When enabled, authorised staff may capture a missing totalizer reading manually with an audit trail.',
    scope: 'station',
  },
  'shifts.unclosedAlertHours': {
    type: 'number', min: 1, max: 72,
    label: 'Unclosed shift alert (hours)',
    description: 'Open shifts older than this appear in the unclosed-shift alert list.',
    scope: 'tenant',
  },
  'shifts.varianceToleranceLitres': {
    type: 'number', min: 0, max: 1000,
    label: 'Shift variance tolerance (litres)',
    description: 'Differences between manual and device closing readings above this value flag the shift for approval.',
    scope: 'station',
  },
  'notifications.contactEmail': {
    type: 'string',
    label: 'Operations contact email',
    description: 'Destination for the alert digest. Email delivery is not configured in this build.',
    scope: 'tenant',
  },
  'notifications.unclosedShiftAlerts': {
    type: 'boolean',
    label: 'Unclosed shift alerts',
    description: 'Show unclosed-shift warnings on dashboards.',
    scope: 'tenant',
  },
};

const DEFAULTS: Record<string, string> = {
  'hardware.maxJumpLitres': '10000',
  'hardware.heartbeatTimeoutMinutes': '5',
  'hardware.allowManualFallback': 'true',
  'shifts.unclosedAlertHours': '14',
  'shifts.varianceToleranceLitres': '1',
  'notifications.contactEmail': '',
  'notifications.unclosedShiftAlerts': 'true',
};

function validateValue(key: string, value: unknown): string {
  const schema = ALLOWED_KEYS[key];
  if (!schema) throw unprocessable(`Unknown setting: ${key}`);
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
      throw unprocessable(`${key} must be true or false`);
    }
    return String(value === true || value === 'true');
  }
  if (schema.type === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw unprocessable(`${key} must be a number`);
    if (schema.min !== undefined && n < schema.min) throw unprocessable(`${key} must be at least ${schema.min}`);
    if (schema.max !== undefined && n > schema.max) throw unprocessable(`${key} must be at most ${schema.max}`);
    return String(n);
  }
  const text = String(value ?? '').trim();
  if (text.length > 200) throw unprocessable(`${key} is too long`);
  return text;
}

settingsRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'settings.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) getStationOrThrow(auth, stationId);
    const rows = all<Record<string, unknown>>(
      "SELECT * FROM app_settings WHERE tenant_id IN (?, '') AND station_id IN (?, '')",
      [tenantId, stationId ?? ''],
    );
    const merged: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      if (row.tenant_id === tenantId || row.tenant_id === '') {
        if (row.value !== null) merged[String(row.key)] = String(row.value);
      }
    }
    const stationRows = rows.filter((r) => r.station_id === stationId);
    return ok(res, {
      settings: merged,
      schema: ALLOWED_KEYS,
      overrides: {
        tenant: shapeAll(rows.filter((r) => r.tenant_id === tenantId && r.station_id === '')),
        station: shapeAll(stationRows),
      },
      effective: Object.fromEntries(
        Object.keys(ALLOWED_KEYS).map((key) => {
          const fallback = DEFAULTS[key] ?? '';
          const type = ALLOWED_KEYS[key]!.type;
          if (type === 'number') return [key, settingsValue(key, tenantId, stationId, Number(fallback))];
          if (type === 'boolean') return [key, settingsValue(key, tenantId, stationId, fallback === 'true')];
          return [key, settingsValue(key, tenantId, stationId, fallback)];
        }),
      ),
    });
  }),
);

settingsRouter.put(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'settings.write')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const body = parse(
      z.object({
        stationId: z.string().min(3).optional().nullable(),
        values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
      }),
      req.body,
    );
    if (body.stationId) getStationOrThrow(auth, body.stationId);
    const entries = Object.entries(body.values);
    if (entries.length === 0) throw unprocessable('No settings supplied');
    const normalised: [string, string][] = [];
    for (const [key, value] of entries) {
      const schema = ALLOWED_KEYS[key];
      if (!schema) throw unprocessable(`Unknown setting: ${key}`);
      if (schema.scope === 'tenant' && body.stationId) {
        throw unprocessable(`${key} is an organization-level setting and cannot be overridden per station`);
      }
      normalised.push([key, validateValue(key, value)]);
    }
    tx(() => {
      for (const [key, value] of normalised) {
        const existing = get<{ id: string }>(
          "SELECT id FROM app_settings WHERE tenant_id = ? AND station_id = ? AND key = ?",
          [tenantId, body.stationId ?? '', key],
        );
        if (existing) {
          run('UPDATE app_settings SET value = ?, updated_by = ?, updated_at = ? WHERE id = ?', [
            value, auth.user.id, nowIso(), existing.id,
          ]);
        } else {
          run(
            `INSERT INTO app_settings (id, tenant_id, station_id, key, value, updated_by, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [newId('set'), tenantId, body.stationId ?? '', key, value, auth.user.id, nowIso()],
          );
        }
      }
    });
    audit(req, {
      action: 'SETTINGS_UPDATED', entity: 'AppSetting', entityId: body.stationId ?? tenantId,
      stationId: body.stationId ?? null,
      summary: `${normalised.length} setting(s) updated: ${normalised.map(([k]) => k).join(', ')}`,
      after: Object.fromEntries(normalised),
    });
    return ok(res, { updated: normalised.length, stationId: body.stationId ?? null });
  }),
);

settingsRouter.get(
  '/diagnostics',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'settings.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) getStationOrThrow(auth, stationId);
    const counts = (table: string, where = '', params: (string | number)[] = []) =>
      get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table} ${where}`, params)?.count ?? 0;

    const eventStates = all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) AS count FROM device_events WHERE tenant_id = ? GROUP BY status`,
      [tenantId],
    );
    const deviceCounts = all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM hardware_devices WHERE tenant_id = ? GROUP BY status',
      [tenantId],
    );
    let dbSize = 0;
    try {
      dbSize = fs.statSync(env.DATABASE_FILE).size;
    } catch {
      dbSize = 0;
    }

    return ok(res, {
      application: {
        name: 'PetroFlow ERP',
        version: env.APP_VERSION,
        apiVersion: env.API_VERSION,
        environment: env.NODE_ENV,
        nodeVersion: process.version,
        platform: `${os.type()} ${os.release()}`,
        uptimeSeconds: Math.round(process.uptime()),
        serverTime: nowIso(),
        timezone: 'Asia/Kolkata',
      },
      database: {
        engine: 'SQLite (node:sqlite) — MySQL 8 / Prisma is the documented production target',
        file: env.DATABASE_FILE.split('/').slice(-2).join('/'),
        sizeBytes: dbSize,
        tenants: counts('tenants'),
        stations: counts('stations', 'WHERE tenant_id = ?', [tenantId]),
        users: counts('users', 'WHERE tenant_id = ?', [tenantId]),
        tanks: counts('tanks', 'WHERE station_id IN (SELECT id FROM stations WHERE tenant_id = ?)', [tenantId]),
        nozzles: counts('nozzles', 'WHERE station_id IN (SELECT id FROM stations WHERE tenant_id = ?)', [tenantId]),
        meterReadings: counts('meter_readings', 'WHERE tenant_id = ?', [tenantId]),
        shifts: counts('shifts', 'WHERE tenant_id = ?', [tenantId]),
        creditEntries: counts('credit_entries', 'WHERE tenant_id = ?', [tenantId]),
        payments: counts('payments', 'WHERE tenant_id = ?', [tenantId]),
        auditLogs: counts('audit_logs', 'WHERE tenant_id = ?', [tenantId]),
      },
      hardware: {
        devices: Object.fromEntries(deviceCounts.map((d) => [d.status, d.count])),
        eventStates: Object.fromEntries(eventStates.map((e) => [e.status, e.count])),
        onlineWindowMinutes: env.DEVICE_ONLINE_WINDOW_MINUTES,
        adapterContractVersion: '1.0.0',
        simulatorEnabled: env.ENABLE_DEMO_TOOLS,
        realHardwareVerified: false,
        note:
          'Gateways authenticate with x-device-key. No real forecourt controller has been integrated or verified; ' +
          'the bundled simulator is clearly labelled and must not be presented as live meter data.',
      },
      security: {
        sessionsAreServerSide: true,
        sessionCookie: env.SESSION_COOKIE_NAME,
        cookieSecure: env.COOKIE_SECURE,
        sessionTtlHours: env.SESSION_TTL_HOURS,
        passwordHashing: 'scrypt (Node.js crypto, per-user salt)',
        rateLimiting: 'express-rate-limit on /auth and gateway ingestion',
        demoPasswordInUse: true,
        demoPasswordWarning: env.isProduction
          ? 'Demo accounts must be removed before production use.'
          : 'Seeded demo accounts use a known password — development environments only.',
      },
      environment: {
        demoMode: env.ENABLE_DEMO_TOOLS,
        seedDemoData: env.SEED_DEMO_DATA,
        trustProxy: env.TRUST_PROXY,
        corsOrigin: env.APP_ORIGIN,
        backupRetentionDays: env.BACKUP_RETENTION_DAYS,
      },
      operations: {
        backup: 'Copy the database file (SQLite online backup) or use mysqldump in MySQL deployments. See docs/OPERATIONS.md.',
        restore: 'Stop the API, replace the database file from the verified backup, then start the API and verify /health.',
        migrations: 'db/schema.sql is idempotent and applied at boot; production MySQL DDL is generated by npm run db:mysql-ddl.',
      },
    });
  }),
);

settingsRouter.get(
  '/subscription',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'billing.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const subscription = get<Record<string, unknown>>(
      `SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.monthly_price, p.annual_price,
              p.max_stations, p.max_users, p.max_dispensers, p.features, p.trial_days
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId],
    );
    if (!subscription) throw notFound('No subscription found');
    const invoices = all(
      'SELECT * FROM subscription_invoices WHERE tenant_id = ? ORDER BY issued_at DESC LIMIT 24',
      [tenantId],
    );
    const usage = {
      stations: get<{ count: number }>('SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?', [tenantId])?.count ?? 0,
      users: get<{ count: number }>('SELECT COUNT(*) AS count FROM users WHERE tenant_id = ?', [tenantId])?.count ?? 0,
      dispensers: get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM dispensers WHERE station_id IN (SELECT id FROM stations WHERE tenant_id = ?)',
        [tenantId],
      )?.count ?? 0,
    };
    const outstanding = invoices
      .filter((i) => ['ISSUED', 'OVERDUE'].includes(String(i.status)))
      .reduce((a, i) => a.plus(D(i.total_amount as string)), D(0));
    return ok(res, {
      subscription: shape(subscription, ['features']),
      invoices: shapeAll(invoices),
      usage,
      outstanding: outstanding.toFixed(2),
      note: 'Subscription invoices are settled outside the station payment ledger; recording them here does not post to station cash.',
    });
  }),
);
