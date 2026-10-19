import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, created, ok, pageMeta, paging, parse, sortClause } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { requirePlatform } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { newIdCompact } from '../lib/ids.js';
import { addDaysIso, istDayEnd, istDayStart, nowIso, todayIst } from '../lib/time.js';
import { D, money } from '../lib/decimal.js';
import { assertPasswordStrength, hashPassword } from '../lib/security.js';

export const adminRouter = Router();
adminRouter.use(requirePlatform);

function count(sql: string, params: (string | number)[] = []): number {
  return get<{ count: number }>(sql, params)?.count ?? 0;
}

// ------------------------------------------------------------------ metrics

adminRouter.get(
  '/metrics',
  asyncHandler((_req, res) => {
    const tenantCounts = all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM tenants GROUP BY status',
    );
    const subscriptionCounts = all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM subscriptions GROUP BY status',
    );
    const planRevenue = all<{ plan: string; code: string; active: number; mrr: string }>(
      `SELECT p.name AS plan, p.code,
              COUNT(s.id) AS active,
              COALESCE(SUM(CAST(p.monthly_price AS REAL)), 0) AS mrr
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.status IN ('ACTIVE','TRIALING')
        GROUP BY p.id, p.name, p.code ORDER BY mrr DESC`,
    );
    const mrr = planRevenue.reduce((acc, row) => acc.plus(D(row.mrr)), D(0));
    const trialEnding = all<Record<string, unknown>>(
      `SELECT s.id, s.tenant_id, s.trial_ends_at, t.name AS tenant_name, p.name AS plan_name
         FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.status = 'TRIALING' AND s.trial_ends_at IS NOT NULL AND s.trial_ends_at <= ?
        ORDER BY s.trial_ends_at LIMIT 10`,
      [addDaysIso(nowIso(), 7)],
    );
    const expiring = all<Record<string, unknown>>(
      `SELECT s.id, s.tenant_id, s.ends_at, t.name AS tenant_name
         FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.status = 'ACTIVE' AND s.ends_at IS NOT NULL AND s.ends_at <= ?
        ORDER BY s.ends_at LIMIT 10`,
      [addDaysIso(nowIso(), 30)],
    );
    const devices = all<{ last_heartbeat_at: string | null; status: string; is_simulated: number }>(
      'SELECT last_heartbeat_at, status, is_simulated FROM hardware_devices',
    );
    const online = devices.filter(
      (d) => d.last_heartbeat_at && Date.now() - new Date(d.last_heartbeat_at).getTime() < 5 * 60_000,
    ).length;
    const invoices = all<{ total_amount: string; status: string }>(
      "SELECT total_amount, status FROM subscription_invoices WHERE status IN ('ISSUED','OVERDUE')",
    );
    const outstanding = invoices.reduce((acc, row) => acc.plus(D(row.total_amount)), D(0));
    const recentTenants = all<Record<string, unknown>>(
      `SELECT t.id, t.name, t.slug, t.status, t.created_at, t.is_demo,
              (SELECT COUNT(*) FROM stations st WHERE st.tenant_id = t.id) AS station_count,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count
         FROM tenants t ORDER BY t.created_at DESC LIMIT 6`,
    );
    const openErrors = all<Record<string, unknown>>(
      "SELECT * FROM platform_errors WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 8",
    );
    const eventCounts = all<{ status: string; count: number }>(
      'SELECT status, COUNT(*) AS count FROM device_events GROUP BY status',
    );

    return ok(res, {
      tenants: {
        total: count('SELECT COUNT(*) AS count FROM tenants'),
        active: tenantCounts.find((t) => t.status === 'ACTIVE')?.count ?? 0,
        suspended: tenantCounts.find((t) => t.status === 'SUSPENDED')?.count ?? 0,
        pending: tenantCounts.find((t) => t.status === 'PENDING')?.count ?? 0,
        demo: count('SELECT COUNT(*) AS count FROM tenants WHERE is_demo = 1'),
      },
      stations: count('SELECT COUNT(*) AS count FROM stations'),
      users: count('SELECT COUNT(*) AS count FROM users'),
      subscriptions: {
        trialing: subscriptionCounts.find((s) => s.status === 'TRIALING')?.count ?? 0,
        active: subscriptionCounts.find((s) => s.status === 'ACTIVE')?.count ?? 0,
        pastDue: subscriptionCounts.find((s) => s.status === 'PAST_DUE')?.count ?? 0,
        suspended: subscriptionCounts.find((s) => s.status === 'SUSPENDED')?.count ?? 0,
        cancelled: subscriptionCounts.find((s) => s.status === 'CANCELLED')?.count ?? 0,
        mrr: money(mrr),
        arr: money(mrr.mul(12)),
        byPlan: planRevenue.map((p) => ({ ...p, mrr: money(p.mrr) })),
        trialsEndingSoon: shapeAll(trialEnding),
        expiringSoon: shapeAll(expiring),
      },
      devices: {
        total: devices.length,
        online,
        offline: devices.filter((d) => !d.last_heartbeat_at || Date.now() - new Date(d.last_heartbeat_at).getTime() >= 5 * 60_000).length,
        simulated: devices.filter((d) => Number(d.is_simulated) === 1).length,
        disabled: devices.filter((d) => d.status === 'DISABLED').length,
        realHardwareVerified: false,
        events: Object.fromEntries(eventCounts.map((e) => [e.status, e.count])),
      },
      invoices: {
        outstanding: money(outstanding),
        overdue: count("SELECT COUNT(*) AS count FROM subscription_invoices WHERE status = 'OVERDUE'"),
        issued: count("SELECT COUNT(*) AS count FROM subscription_invoices WHERE status = 'ISSUED'"),
      },
      errors: { open: count('SELECT COUNT(*) AS count FROM platform_errors WHERE resolved_at IS NULL'), recent: shapeAll(openErrors) },
      recentTenants: shapeAll(recentTenants),
      note:
        'Platform metrics show subscription and operational aggregates only. Tenant fuel sales, ledgers and customer data are not exposed here.',
      generatedAt: nowIso(),
    });
  }),
);

// ------------------------------------------------------------------ tenants

adminRouter.get(
  '/tenants',
  asyncHandler((req, res) => {
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['1=1'];
    const params: (string | number)[] = [];
    if (typeof req.query.status === 'string' && req.query.status) {
      clauses.push('t.status = ?');
      params.push(req.query.status);
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      clauses.push('(t.name LIKE ? OR t.slug LIKE ? OR t.contact_email LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = clauses.join(' AND ');
    const order = sortClause(req.query as Record<string, unknown>, { name: 't.name', createdAt: 't.created_at' }, 't.created_at DESC');
    const total = count(`SELECT COUNT(*) AS count FROM tenants t WHERE ${where}`, params);
    const rows = all(
      `SELECT t.*,
              (SELECT COUNT(*) FROM stations st WHERE st.tenant_id = t.id) AS station_count,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
              s.status AS subscription_status, s.ends_at AS subscription_ends_at, s.trial_ends_at,
              pl.name AS plan_name, pl.code AS plan_code
         FROM tenants t
         LEFT JOIN subscriptions s ON s.id = (SELECT id FROM subscriptions WHERE tenant_id = t.id ORDER BY created_at DESC LIMIT 1)
         LEFT JOIN subscription_plans pl ON pl.id = s.plan_id
        WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

adminRouter.get(
  '/tenants/:id',
  asyncHandler((req, res) => {
    const tenant = get<Record<string, unknown>>('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) throw notFound('Organization not found');
    const stations = all('SELECT * FROM stations WHERE tenant_id = ? ORDER BY name', [tenant.id]);
    const users = all(
      `SELECT id, name, email, phone, role_key, status, last_login_at, created_at
         FROM users WHERE tenant_id = ? ORDER BY role_key, name`,
      [tenant.id],
    );
    const subscription = get<Record<string, unknown>>(
      `SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.monthly_price, p.max_stations, p.max_users, p.max_dispensers
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [tenant.id],
    );
    const invoices = all(
      'SELECT * FROM subscription_invoices WHERE tenant_id = ? ORDER BY issued_at DESC LIMIT 24',
      [tenant.id],
    );
    const devices = all(
      `SELECT d.*, st.name AS station_name FROM hardware_devices d JOIN stations st ON st.id = d.station_id
        WHERE d.tenant_id = ? ORDER BY st.name, d.name`,
      [tenant.id],
    );
    const auditTrail = all(
      'SELECT * FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 25',
      [tenant.id],
    );
    const usage = {
      stations: stations.length,
      users: users.length,
      dispensers: count(
        'SELECT COUNT(*) AS count FROM dispensers WHERE station_id IN (SELECT id FROM stations WHERE tenant_id = ?)',
        [String(tenant.id)],
      ),
      maxStations: (subscription?.max_stations as number | null) ?? null,
      maxUsers: (subscription?.max_users as number | null) ?? null,
      maxDispensers: (subscription?.max_dispensers as number | null) ?? null,
    };
    return ok(res, {
      tenant: shape(tenant),
      subscription: shape(subscription),
      stations: shapeAll(stations),
      users: shapeAll(users),
      invoices: shapeAll(invoices),
      devices: shapeAll(devices),
      auditTrail: shapeAll(auditTrail, ['beforeData', 'afterData']),
      usage,
    });
  }),
);

const onboardSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens'),
  legalName: z.string().max(160).optional().nullable(),
  gstin: z.string().max(20).optional().nullable(),
  contactEmail: z.string().email().max(160),
  contactPhone: z.string().max(20).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  state: z.string().max(80).optional().nullable(),
  planCode: z.string().min(2).max(30),
  trialDays: z.coerce.number().int().min(0).max(90).optional(),
  ownerName: z.string().min(2).max(120),
  ownerEmail: z.string().email().max(160),
  ownerPassword: z.string().min(10).max(200),
  createDefaultStation: z.boolean().optional(),
});

adminRouter.post(
  '/tenants',
  asyncHandler((req, res) => {
    const body = parse(onboardSchema, req.body);
    assertPasswordStrength(body.ownerPassword);
    if (get('SELECT id FROM tenants WHERE slug = ?', [body.slug])) throw conflict('That organization slug is already in use');
    const email = body.ownerEmail.toLowerCase().trim();
    if (get('SELECT id FROM users WHERE email = ?', [email])) throw conflict('A user with this email already exists');
    const plan = get<Record<string, unknown>>('SELECT * FROM subscription_plans WHERE code = ? AND is_active = 1', [body.planCode]);
    if (!plan) throw notFound('Subscription plan not found');
    const trialDays = body.trialDays ?? Number(plan.trial_days ?? 14);
    const tenantId = newId('tnt');
    const subscriptionId = newId('sub');
    const ownerId = newId('usr');
    let stationId: string | null = null;
    tx(() => {
      run(
        `INSERT INTO tenants (id, name, slug, legal_name, gstin, contact_email, contact_phone, city, state, status, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, ?, ?)`,
        [tenantId, body.name, body.slug, body.legalName ?? null, body.gstin ?? null, body.contactEmail,
          body.contactPhone ?? null, body.city ?? null, body.state ?? null, nowIso(), nowIso()],
      );
      run(
        `INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, ends_at, trial_ends_at, seats, auto_renew, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [subscriptionId, tenantId, plan.id, trialDays > 0 ? 'TRIALING' : 'ACTIVE', nowIso(),
          trialDays > 0 ? null : addDaysIso(nowIso(), 365),
          trialDays > 0 ? addDaysIso(nowIso(), trialDays) : null, Number(plan.max_users ?? 5), nowIso(), nowIso()],
      );
      run(
        `INSERT INTO users (id, tenant_id, email, name, password_hash, role_key, status, must_change_password, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'OWNER', 'ACTIVE', 1, 0, ?, ?)`,
        [ownerId, tenantId, email, body.ownerName, hashPassword(body.ownerPassword), nowIso(), nowIso()],
      );
      if (body.createDefaultStation) {
        stationId = newId('stn');
        run(
          `INSERT INTO stations (id, tenant_id, code, name, city, state, timezone, status, is_demo, created_at, updated_at)
           VALUES (?, ?, 'MAIN', ?, ?, ?, 'Asia/Kolkata', 'ACTIVE', 0, ?, ?)`,
          [stationId, tenantId, body.name, body.city ?? null, body.state ?? null, nowIso(), nowIso()],
        );
      }
    });
    audit(req, {
      action: 'TENANT_ONBOARDED', entity: 'Tenant', entityId: tenantId, tenantId,
      summary: `${body.name} onboarded on ${String(plan.name)} with owner ${email}`,
      after: { planCode: body.planCode, trialDays, stationId },
    });
    return created(res, {
      tenantId,
      ownerId,
      subscriptionId,
      stationId,
      ownerEmail: email,
      note: 'The owner must change the temporary password at first sign-in. There is no public self-registration.',
    });
  }),
);

adminRouter.patch(
  '/tenants/:id',
  asyncHandler((req, res) => {
    const tenant = get<Record<string, unknown>>('SELECT * FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) throw notFound('Organization not found');
    const body = parse(
      z.object({
        name: z.string().min(2).max(120).optional(),
        legalName: z.string().max(160).optional().nullable(),
        gstin: z.string().max(20).optional().nullable(),
        contactEmail: z.string().email().max(160).optional(),
        contactPhone: z.string().max(20).optional().nullable(),
        city: z.string().max(80).optional().nullable(),
        state: z.string().max(80).optional().nullable(),
        status: z.enum(['ACTIVE', 'SUSPENDED', 'PENDING']).optional(),
        notes: z.string().max(1000).optional().nullable(),
      }),
      req.body,
    );
    const map: Record<string, string> = {
      name: 'name', legalName: 'legal_name', gstin: 'gstin', contactEmail: 'contact_email',
      contactPhone: 'contact_phone', city: 'city', state: 'state', status: 'status', notes: 'notes',
    };
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      tx(() => {
        run(
          `UPDATE tenants SET ${entries.map(([k]) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          [...entries.map(([, v]) => v as string), nowIso(), String(tenant.id)],
        );
        if (body.status === 'SUSPENDED') {
          // Suspension invalidates every active session for the organization.
          run(
            'UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE tenant_id = ?)',
            [nowIso(), String(tenant.id)],
          );
        }
        if (body.status === 'SUSPENDED') {
          run("UPDATE subscriptions SET status = 'SUSPENDED', updated_at = ? WHERE tenant_id = ? AND status != 'CANCELLED'", [
            nowIso(), String(tenant.id),
          ]);
        }
      });
    }
    audit(req, {
      action: body.status === 'SUSPENDED' ? 'TENANT_SUSPENDED' : body.status === 'ACTIVE' && tenant.status !== 'ACTIVE' ? 'TENANT_REACTIVATED' : 'TENANT_UPDATED',
      entity: 'Tenant', entityId: String(tenant.id), tenantId: String(tenant.id),
      summary: `${String(tenant.name)}: ${body.status ? `status ${String(tenant.status)} → ${body.status}` : 'profile updated'}`,
      before: { status: tenant.status }, after: body,
    });
    return ok(res, shape(get('SELECT * FROM tenants WHERE id = ?', [String(tenant.id)])));
  }),
);

// ----------------------------------------------------------------- stations

adminRouter.get(
  '/stations',
  asyncHandler((req, res) => {
    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : null;
    const rows = all(
      `SELECT s.*, t.name AS tenant_name, t.status AS tenant_status,
              (SELECT COUNT(*) FROM dispensers d WHERE d.station_id = s.id) AS dispenser_count,
              (SELECT COUNT(*) FROM tanks tk WHERE tk.station_id = s.id) AS tank_count,
              (SELECT COUNT(*) FROM hardware_devices h WHERE h.station_id = s.id) AS device_count
         FROM stations s JOIN tenants t ON t.id = s.tenant_id
        ${tenantId ? 'WHERE s.tenant_id = ?' : ''}
        ORDER BY t.name, s.name`,
      tenantId ? [tenantId] : [],
    );
    return ok(res, shapeAll(rows));
  }),
);

adminRouter.post(
  '/stations',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        tenantId: z.string().min(3),
        code: z.string().min(1).max(20),
        name: z.string().min(2).max(120),
        address: z.string().max(300).optional().nullable(),
        city: z.string().max(80).optional().nullable(),
        state: z.string().max(80).optional().nullable(),
      }),
      req.body,
    );
    const tenant = get('SELECT id FROM tenants WHERE id = ?', [body.tenantId]);
    if (!tenant) throw notFound('Organization not found');
    const id = newId('stn');
    run(
      `INSERT INTO stations (id, tenant_id, code, name, address, city, state, timezone, status, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Asia/Kolkata', 'ACTIVE', 0, ?, ?)`,
      [id, body.tenantId, body.code, body.name, body.address ?? null, body.city ?? null, body.state ?? null, nowIso(), nowIso()],
    );
    audit(req, {
      action: 'STATION_CREATED_BY_PLATFORM', entity: 'Station', entityId: id, tenantId: body.tenantId, stationId: id,
      summary: `${body.name} created by platform administrator`,
    });
    return created(res, shape(get('SELECT * FROM stations WHERE id = ?', [id])));
  }),
);

adminRouter.patch(
  '/stations/:id',
  asyncHandler((req, res) => {
    const station = get<Record<string, unknown>>('SELECT * FROM stations WHERE id = ?', [req.params.id]);
    if (!station) throw notFound('Station not found');
    const body = parse(
      z.object({
        name: z.string().min(2).max(120).optional(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
        city: z.string().max(80).optional().nullable(),
        state: z.string().max(80).optional().nullable(),
      }),
      req.body,
    );
    const map: Record<string, string> = { name: 'name', status: 'status', city: 'city', state: 'state' };
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      run(
        `UPDATE stations SET ${entries.map(([k]) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...entries.map(([, v]) => v as string), nowIso(), String(station.id)],
      );
    }
    audit(req, {
      action: 'STATION_UPDATED_BY_PLATFORM', entity: 'Station', entityId: String(station.id),
      tenantId: String(station.tenant_id), stationId: String(station.id),
      summary: `${String(station.name)} updated by platform administrator`, before: station, after: body,
    });
    return ok(res, shape(get('SELECT * FROM stations WHERE id = ?', [String(station.id)])));
  }),
);

// -------------------------------------------------------------------- plans

adminRouter.get(
  '/plans',
  asyncHandler((_req, res) => {
    const rows = all<Record<string, unknown>>(
      `SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status IN ('ACTIVE','TRIALING')) AS subscribers
         FROM subscription_plans p ORDER BY CAST(p.monthly_price AS REAL)`,
    );
    return ok(res, shapeAll(rows, ['features']));
  }),
);

adminRouter.post(
  '/plans',
  asyncHandler((req, res) => {
    const body = parse(
      z.object({
        code: z.string().min(2).max(20).regex(/^[A-Za-z0-9_-]+$/),
        name: z.string().min(2).max(80),
        description: z.string().max(300).optional().nullable(),
        monthlyPrice: z.union([z.string(), z.number()]).transform(String),
        annualPrice: z.union([z.string(), z.number()]).transform(String).optional(),
        maxStations: z.coerce.number().int().min(1).max(500),
        maxUsers: z.coerce.number().int().min(1).max(2000),
        maxDispensers: z.coerce.number().int().min(1).max(500),
        trialDays: z.coerce.number().int().min(0).max(90).optional(),
        features: z.array(z.string().max(80)).max(30).optional(),
      }),
      req.body,
    );
    if (get('SELECT id FROM subscription_plans WHERE code = ?', [body.code.toUpperCase()])) {
      throw conflict('A plan with this code already exists');
    }
    const id = newId('pln');
    const annual = body.annualPrice ?? money(D(body.monthlyPrice).mul(12).mul(0.85));
    run(
      `INSERT INTO subscription_plans
        (id, code, name, description, monthly_price, annual_price, max_stations, max_users, max_dispensers,
         features, trial_days, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, body.code.toUpperCase(), body.name, body.description ?? null, money(D(body.monthlyPrice)), annual,
        body.maxStations, body.maxUsers, body.maxDispensers, JSON.stringify(body.features ?? []),
        body.trialDays ?? 14, nowIso(), nowIso()],
    );
    audit(req, {
      action: 'PLAN_CREATED', entity: 'SubscriptionPlan', entityId: id, tenantId: null,
      summary: `${body.name} plan at ₹${money(D(body.monthlyPrice))}/month`,
    });
    return created(res, shape(get('SELECT * FROM subscription_plans WHERE id = ?', [id]), ['features']));
  }),
);

adminRouter.patch(
  '/plans/:id',
  asyncHandler((req, res) => {
    const plan = get<Record<string, unknown>>('SELECT * FROM subscription_plans WHERE id = ?', [req.params.id]);
    if (!plan) throw notFound('Plan not found');
    const body = parse(
      z.object({
        name: z.string().min(2).max(80).optional(),
        description: z.string().max(300).optional().nullable(),
        monthlyPrice: z.union([z.string(), z.number()]).transform(String).optional(),
        annualPrice: z.union([z.string(), z.number()]).transform(String).optional(),
        maxStations: z.coerce.number().int().min(1).max(500).optional(),
        maxUsers: z.coerce.number().int().min(1).max(2000).optional(),
        maxDispensers: z.coerce.number().int().min(1).max(500).optional(),
        trialDays: z.coerce.number().int().min(0).max(90).optional(),
        isActive: z.boolean().optional(),
      }),
      req.body,
    );
    const map: Record<string, string> = {
      name: 'name', description: 'description', monthlyPrice: 'monthly_price', annualPrice: 'annual_price',
      maxStations: 'max_stations', maxUsers: 'max_users', maxDispensers: 'max_dispensers',
      trialDays: 'trial_days', isActive: 'is_active',
    };
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      run(
        `UPDATE subscription_plans SET ${entries.map(([k]) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : v as string)), nowIso(), String(plan.id)],
      );
    }
    audit(req, {
      action: 'PLAN_UPDATED', entity: 'SubscriptionPlan', entityId: String(plan.id), tenantId: null,
      summary: `${String(plan.name)} plan updated`, before: plan, after: body,
    });
    return ok(res, shape(get('SELECT * FROM subscription_plans WHERE id = ?', [String(plan.id)]), ['features']));
  }),
);

// ------------------------------------------------------------ subscriptions

adminRouter.get(
  '/subscriptions',
  asyncHandler((req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const rows = all(
      `SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.monthly_price, p.max_stations, p.max_users,
              t.name AS tenant_name, t.slug AS tenant_slug, t.status AS tenant_status,
              (SELECT COUNT(*) FROM stations st WHERE st.tenant_id = t.id) AS station_count,
              (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count
         FROM subscriptions s
         JOIN subscription_plans p ON p.id = s.plan_id
         JOIN tenants t ON t.id = s.tenant_id
        ${status ? 'WHERE s.status = ?' : ''}
        ORDER BY s.created_at DESC`,
      status ? [status] : [],
    );
    return ok(res, shapeAll(rows));
  }),
);

adminRouter.post(
  '/tenants/:tenantId/subscription',
  asyncHandler((req, res) => {
    const tenant = get('SELECT id FROM tenants WHERE id = ?', [req.params.tenantId]);
    if (!tenant) throw notFound('Organization not found');
    const body = parse(
      z.object({
        planCode: z.string().min(2).max(20),
        status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
        trialDays: z.coerce.number().int().min(0).max(90).optional(),
        endsAt: z.string().datetime().optional().nullable(),
      }),
      req.body,
    );
    const plan = get<Record<string, unknown>>('SELECT * FROM subscription_plans WHERE code = ? AND is_active = 1', [
      body.planCode.toUpperCase(),
    ]);
    if (!plan) throw notFound('Plan not found');
    const trialDays = body.trialDays ?? 0;
    const status = body.status ?? (trialDays > 0 ? 'TRIALING' : 'ACTIVE');
    const id = newId('sub');
    tx(() => {
      run("UPDATE subscriptions SET status = 'CANCELLED', updated_at = ? WHERE tenant_id = ? AND status IN ('ACTIVE','TRIALING')", [
        nowIso(), String(tenant.id),
      ]);
      run(
        `INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, ends_at, trial_ends_at, seats, auto_renew, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, String(tenant.id), plan.id, status, nowIso(),
          body.endsAt ?? (status === 'ACTIVE' ? addDaysIso(nowIso(), 365) : null),
          trialDays > 0 ? addDaysIso(nowIso(), trialDays) : null, Number(plan.max_users ?? 5), nowIso(), nowIso()],
      );
    });
    audit(req, {
      action: 'SUBSCRIPTION_CREATED', entity: 'Subscription', entityId: id, tenantId: String(tenant.id),
      summary: `${String(plan.name)} subscription created (${status})`,
    });
    return created(res, shape(get('SELECT * FROM subscriptions WHERE id = ?', [id])));
  }),
);

adminRouter.patch(
  '/subscriptions/:id',
  asyncHandler((req, res) => {
    const subscription = get<Record<string, unknown>>('SELECT * FROM subscriptions WHERE id = ?', [req.params.id]);
    if (!subscription) throw notFound('Subscription not found');
    const body = parse(
      z.object({
        status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
        endsAt: z.string().datetime().optional().nullable(),
        trialEndsAt: z.string().datetime().optional().nullable(),
        seats: z.coerce.number().int().min(1).max(2000).optional(),
        autoRenew: z.boolean().optional(),
        notes: z.string().max(500).optional().nullable(),
      }),
      req.body,
    );
    const map: Record<string, string> = {
      status: 'status', endsAt: 'ends_at', trialEndsAt: 'trial_ends_at', seats: 'seats', autoRenew: 'auto_renew', notes: 'notes',
    };
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      run(
        `UPDATE subscriptions SET ${entries.map(([k]) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...entries.map(([, v]) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as string | null))), nowIso(), String(subscription.id)],
      );
    }
    if (body.status === 'SUSPENDED' || body.status === 'CANCELLED') {
      run('UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?', ['SUSPENDED', nowIso(), String(subscription.tenant_id)]);
      run(
        'UPDATE sessions SET revoked_at = ? WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE tenant_id = ?)',
        [nowIso(), String(subscription.tenant_id)],
      );
    }
    if (body.status === 'ACTIVE' || body.status === 'TRIALING') {
      run("UPDATE tenants SET status = 'ACTIVE', updated_at = ? WHERE id = ?", [nowIso(), String(subscription.tenant_id)]);
    }
    audit(req, {
      action: 'SUBSCRIPTION_UPDATED', entity: 'Subscription', entityId: String(subscription.id),
      tenantId: String(subscription.tenant_id),
      summary: `Subscription ${String(subscription.status)} → ${body.status ?? String(subscription.status)}`,
      before: { status: subscription.status, endsAt: subscription.ends_at }, after: body,
    });
    return ok(res, shape(get('SELECT * FROM subscriptions WHERE id = ?', [String(subscription.id)])));
  }),
);

// ----------------------------------------------------------------- invoices

adminRouter.get(
  '/invoices',
  asyncHandler((req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const rows = all(
      `SELECT i.*, t.name AS tenant_name, t.slug AS tenant_slug
         FROM subscription_invoices i JOIN tenants t ON t.id = i.tenant_id
        ${status ? 'WHERE i.status = ?' : ''}
        ORDER BY i.issued_at DESC LIMIT 200`,
      status ? [status] : [],
    );
    return ok(res, shapeAll(rows));
  }),
);

adminRouter.post(
  '/tenants/:tenantId/invoices',
  asyncHandler((req, res) => {
    const tenant = get<Record<string, unknown>>('SELECT * FROM tenants WHERE id = ?', [req.params.tenantId]);
    if (!tenant) throw notFound('Organization not found');
    const subscription = get<Record<string, unknown>>(
      'SELECT * FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1',
      [tenant.id],
    );
    if (!subscription) throw unprocessable('This organization has no subscription');
    const plan = get<Record<string, unknown>>('SELECT * FROM subscription_plans WHERE id = ?', [subscription.plan_id]);
    const body = parse(
      z.object({
        periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        amount: z.union([z.string(), z.number()]).transform(String).optional(),
        taxAmount: z.union([z.string(), z.number()]).transform(String).optional(),
        dueInDays: z.coerce.number().int().min(1).max(120).optional(),
        notes: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    if (new Date(body.periodEnd) < new Date(body.periodStart)) throw unprocessable('Period end must be after period start');
    const amount = D(String(body.amount ?? plan?.monthly_price ?? 0));
    const tax = D(body.taxAmount ?? 0);
    const total = amount.plus(tax);
    const seq = count('SELECT COUNT(*) AS count FROM subscription_invoices') + 1;
    const invoiceNumber = `PF-${todayIst().replace(/-/g, '')}-${String(seq).padStart(4, '0')}`;
    const id = newId('inv');
    run(
      `INSERT INTO subscription_invoices
        (id, tenant_id, subscription_id, invoice_number, period_start, period_end, amount, tax_amount,
         total_amount, status, issued_at, due_at, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ISSUED', ?, ?, ?, ?)`,
      [id, String(tenant.id), String(subscription.id), invoiceNumber, body.periodStart, body.periodEnd,
        money(amount), money(tax), money(total), nowIso(),
        addDaysIso(nowIso(), body.dueInDays ?? 15), body.notes ?? null, nowIso()],
    );
    audit(req, {
      action: 'SUBSCRIPTION_INVOICE_ISSUED', entity: 'SubscriptionInvoice', entityId: id, tenantId: String(tenant.id),
      summary: `Invoice ${invoiceNumber} for ₹${money(total)} (${body.periodStart} → ${body.periodEnd})`,
    });
    return created(res, shape(get('SELECT * FROM subscription_invoices WHERE id = ?', [id])));
  }),
);

adminRouter.post(
  '/invoices/:id/mark-paid',
  asyncHandler((req, res) => {
    const invoice = get<Record<string, unknown>>('SELECT * FROM subscription_invoices WHERE id = ?', [req.params.id]);
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'PAID') throw conflict('Invoice is already marked paid');
    const body = parse(
      z.object({
        paymentReference: z.string().min(2).max(80),
        paymentMethod: z.enum(['BANK', 'UPI', 'CARD', 'CHEQUE']).optional(),
        paidAt: z.string().datetime().optional(),
      }),
      req.body,
    );
    run(
      "UPDATE subscription_invoices SET status = 'PAID', paid_at = ?, payment_reference = ?, payment_method = ? WHERE id = ?",
      [body.paidAt ?? nowIso(), body.paymentReference, body.paymentMethod ?? 'BANK', String(invoice.id)],
    );
    audit(req, {
      action: 'SUBSCRIPTION_INVOICE_PAID', entity: 'SubscriptionInvoice', entityId: String(invoice.id),
      tenantId: String(invoice.tenant_id),
      summary: `Invoice ${String(invoice.invoice_number)} marked paid (${body.paymentReference})`,
    });
    return ok(res, shape(get('SELECT * FROM subscription_invoices WHERE id = ?', [String(invoice.id)])));
  }),
);

adminRouter.post(
  '/invoices/:id/overdue',
  asyncHandler((req, res) => {
    const invoice = get<Record<string, unknown>>('SELECT * FROM subscription_invoices WHERE id = ?', [req.params.id]);
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status === 'PAID') throw conflict('Paid invoices cannot be marked overdue');
    run("UPDATE subscription_invoices SET status = 'OVERDUE' WHERE id = ?", [String(invoice.id)]);
    audit(req, {
      action: 'SUBSCRIPTION_INVOICE_OVERDUE', entity: 'SubscriptionInvoice', entityId: String(invoice.id),
      tenantId: String(invoice.tenant_id),
      summary: `Invoice ${String(invoice.invoice_number)} marked overdue`,
    });
    return ok(res, shape(get('SELECT * FROM subscription_invoices WHERE id = ?', [String(invoice.id)])));
  }),
);

// -------------------------------------------------------------------- audit

adminRouter.get(
  '/audit',
  asyncHandler((req, res) => {
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['1=1'];
    const params: (string | number)[] = [];
    if (typeof req.query.tenantId === 'string' && req.query.tenantId) {
      clauses.push('tenant_id = ?');
      params.push(req.query.tenantId);
    }
    if (typeof req.query.action === 'string' && req.query.action) {
      clauses.push('action = ?');
      params.push(req.query.action);
    }
    if (typeof req.query.from === 'string' && req.query.from) { clauses.push('created_at >= ?'); params.push(istDayStart(req.query.from)); }
    if (typeof req.query.to === 'string' && req.query.to) { clauses.push('created_at <= ?'); params.push(istDayEnd(req.query.to)); }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      clauses.push('(summary LIKE ? OR actor_email LIKE ? OR action LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = clauses.join(' AND ');
    const total = count(`SELECT COUNT(*) AS count FROM audit_logs WHERE ${where}`, params);
    const rows = all(
      `SELECT a.*, t.name AS tenant_name FROM audit_logs a LEFT JOIN tenants t ON t.id = a.tenant_id
        WHERE ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows, ['beforeData', 'afterData']), pageMeta(total, p));
  }),
);

// ----------------------------------------------------------- device health

adminRouter.get(
  '/devices',
  asyncHandler((_req, res) => {
    const rows = all<Record<string, unknown>>(
      `SELECT d.id, d.code, d.name, d.type, d.status, d.is_simulated, d.last_heartbeat_at, d.last_sync_at,
              d.key_version, d.vendor, d.model, d.protocol,
              s.name AS station_name, t.name AS tenant_name, t.id AS tenant_id,
              (SELECT COUNT(*) FROM device_events e WHERE e.device_id = d.id) AS event_count,
              (SELECT COUNT(*) FROM device_events e WHERE e.device_id = d.id AND e.status IN ('REJECTED','ERROR')) AS error_count
         FROM hardware_devices d
         JOIN stations s ON s.id = d.station_id
         JOIN tenants t ON t.id = d.tenant_id
        ORDER BY t.name, s.name, d.name`,
    );
    return ok(res, {
      devices: rows.map((row) => ({
        ...shape(row),
        online: row.last_heartbeat_at != null && Date.now() - new Date(String(row.last_heartbeat_at)).getTime() < 5 * 60_000,
      })),
      onlineWindowMinutes: 5,
      realHardwareVerified: false,
      note: 'Device health is derived from heartbeat timestamps only. Real hardware connectivity remains unverified.',
    });
  }),
);

// ------------------------------------------------------------------- errors

adminRouter.get(
  '/errors',
  asyncHandler((req, res) => {
    const p = paging(req.query as Record<string, unknown>);
    const where = req.query.resolved === 'true' ? '1=1' : 'resolved_at IS NULL';
    const total = count(`SELECT COUNT(*) AS count FROM platform_errors WHERE ${where}`);
    const rows = all(
      `SELECT e.*, t.name AS tenant_name FROM platform_errors e LEFT JOIN tenants t ON t.id = e.tenant_id
        WHERE ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

adminRouter.patch(
  '/errors/:id/resolve',
  asyncHandler((req, res) => {
    const row = get<Record<string, unknown>>('SELECT * FROM platform_errors WHERE id = ?', [req.params.id]);
    if (!row) throw notFound('Error not found');
    if (row.resolved_at) throw conflict('Error is already resolved');
    run('UPDATE platform_errors SET resolved_at = ? WHERE id = ?', [nowIso(), req.params.id]);
    audit(req, {
      action: 'PLATFORM_ERROR_RESOLVED', entity: 'PlatformError', entityId: String(row.id),
      tenantId: (row.tenant_id as string | null) ?? null,
      summary: String(row.message).slice(0, 200),
    });
    return ok(res, { resolved: true });
  }),
);

// ------------------------------------------------------ tenant usage limits

adminRouter.get(
  '/tenants/:id/usage',
  asyncHandler((req, res) => {
    const tenant = get('SELECT id FROM tenants WHERE id = ?', [req.params.id]);
    if (!tenant) throw notFound('Organization not found');
    const subscription = get<Record<string, unknown>>(
      `SELECT s.*, p.max_stations, p.max_users, p.max_dispensers
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [req.params.id],
    );
    const usage = {
      stations: count('SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?', [req.params.id]),
      users: count('SELECT COUNT(*) AS count FROM users WHERE tenant_id = ?', [req.params.id]),
      dispensers: count(
        'SELECT COUNT(*) AS count FROM dispensers WHERE station_id IN (SELECT id FROM stations WHERE tenant_id = ?)',
        [req.params.id],
      ),
    };
    return ok(res, {
      usage: {
        ...usage,
        maxStations: subscription?.max_stations ?? null,
        maxUsers: subscription?.max_users ?? null,
        maxDispensers: subscription?.max_dispensers ?? null,
      },
      withinLimits: {
        stations: !subscription || usage.stations <= Number(subscription.max_stations),
        users: !subscription || usage.users <= Number(subscription.max_users),
        dispensers: !subscription || usage.dispensers <= Number(subscription.max_dispensers),
      },
    });
  }),
);
