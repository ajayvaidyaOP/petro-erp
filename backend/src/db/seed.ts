/**
 * Development demo seed. Every record is marked is_demo = 1 and the UI shows a
 * "DEMO DATA" badge. Never run this against a production database.
 */
import { createHash } from 'node:crypto';
import { all, get, run, tx } from './index.js';
import { newId } from '../lib/ids.js';
import { hashPassword } from '../lib/security.js';
import { addDays } from '../lib/time.js';
import { D, Decimal, money, litres as fmtLitres, rate as fmtRate } from '../lib/decimal.js';
import { evaluateDensity } from '../lib/density.js';
import { ROLE_DEFINITIONS, SYSTEM_ROLE_KEYS, RETIRED_ROLE_KEYS, BUSINESS_ROLE_KEYS } from '@petroflow/shared';
import { audit } from '../lib/audit.js';
import { logger } from '../lib/logger.js';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'PetroFlow@2025';

function isoAt(date: string, hour: number, minute = 0) {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000+05:30`).toISOString();
}

function businessDate(daysAgo: number) {
  const today = new Date();
  const ist = new Date(today.getTime() + 5.5 * 3600_000);
  return addDays(ist.toISOString().slice(0, 10), -daysAgo);
}

const nowIso = () => new Date().toISOString();

let rngState = 987654321;
function rand() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648;
  return rngState / 2147483648;
}
function randBetween(min: number, max: number) {
  return min + rand() * (max - min);
}

interface SeededNozzle {
  id: string;
  stationId: string;
  tenantId: string;
  productId: string;
  dispenserId: string;
  dispenserCode: string;
  number: number;
  label: string;
  deviceId: string;
  totalizer: Decimal;
  sequence: number;
}

/**
 * Keep the system roles in sync with @petroflow/shared definitions. Runs on
 * every boot (not just first seed) so newly added permissions reach existing
 * databases without a reset.
 */
export function syncRoles() {
  tx(() => {
    for (const key of SYSTEM_ROLE_KEYS) {
      const def = ROLE_DEFINITIONS[key as keyof typeof ROLE_DEFINITIONS] ?? {
        name: 'Platform Administrator', description: 'Internal platform maintenance.',
        permissions: ['platform.manage', 'platform.audit', 'settings.read'], scope: 'PLATFORM',
      };
      run(
        `INSERT INTO roles (id, key, name, description, permissions, scope, is_system)
         VALUES (?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT(key) DO UPDATE SET name = excluded.name, description = excluded.description,
           permissions = excluded.permissions, scope = excluded.scope`,
        [newId('rol'), key, def.name, def.description, JSON.stringify(def.permissions), def.scope],
      );
    }
    // Retired roles never retain write access. Historical user/shift references remain intact.
    for (const key of RETIRED_ROLE_KEYS) {
      run(`UPDATE roles SET permissions = '[]', name = 'Retired account', description = 'Consolidated into the two-role team model.' WHERE key = ?`, [key]);
    }
    // Never promote a legacy operator/cashier into a manager. Retain their original
    // role on the disabled account so re-enabling cannot silently grant new rights.
    const tenants = all<{ id: string }>('SELECT id FROM tenants');
    for (const tenant of tenants) {
      const users = all<{ id: string; role_key: string; email: string; status: string }>(
        `SELECT id, role_key, email, status FROM users WHERE tenant_id = ? AND status = 'ACTIVE'
         ORDER BY created_at, id`, [tenant.id],
      );
      const kept = new Set<string>();
      for (const role of BUSINESS_ROLE_KEYS) {
        const candidate = users.find((u) => u.role_key === role);
        if (candidate) kept.add(candidate.id);
      }
      for (const user of users) {
        if (kept.has(user.id)) continue;
        run(`UPDATE users SET status = 'DISABLED', updated_at = ? WHERE id = ?`, [nowIso(), user.id]);
        run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), user.id]);
        audit(null, {
          action: 'TEAM_ACCESS_CONSOLIDATED', entity: 'User', entityId: user.id, tenantId: tenant.id,
          summary: 'Access retired for the one-owner, one-manager team. Historical records preserved.',
          before: { roleKey: user.role_key, status: user.status }, after: { status: 'DISABLED' },
        });
      }
    }
    run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_role_per_tenant
      ON users(tenant_id, role_key) WHERE status = 'ACTIVE' AND role_key IN ('OWNER', 'MANAGER')`);
  });
}

export async function runSeed(options: { force?: boolean; legacyTestFixtures?: boolean } = {}) {
  // Existing authorization tests explicitly opt into their multi-tenant fixture.
  const legacyTestFixtures = process.env.NODE_ENV === 'test' && options.legacyTestFixtures === true;
  const existing = get<{ count: number }>('SELECT COUNT(*) AS count FROM tenants')?.count ?? 0;
  if (existing > 0 && !options.force) {
    logger.info('Seed skipped — tenants already exist.');
    return { seeded: false };
  }
  logger.info('Seeding PetroFlow demo data…');

  tx(() => {
    // Role definitions and safe access consolidation are shared with boot migrations.
    syncRoles();

    // -------------------------------------------------------------- plans ---
    const planSpecs = [
      {
        code: 'STARTER', name: 'Starter', price: '2999.00', annual: '32389.00',
        desc: 'Single outlet, core operations and hardware gateway.',
        stations: 1, users: 2, dispensers: 4, trial: 14,
        features: ['1 station', 'Owner + manager', 'Totalizer capture', 'Shift management', 'DSR reports', '1 gateway'],
      },
      {
        code: 'GROWTH', name: 'Growth', price: '7499.00', annual: '80989.00',
        desc: 'Multi-outlet groups with ledgers, credit control and reconciliation.',
        stations: 3, users: 2, dispensers: 12, trial: 14,
        features: ['3 stations', 'Owner + manager', 'Credit ledger', 'Reconciliation', 'Audit trail', 'Priority support'],
      },
      {
        code: 'ENTERPRISE', name: 'Enterprise', price: '18999.00', annual: '205189.00',
        desc: 'Large networks with advanced controls and dedicated onboarding.',
        stations: 10, users: 2, dispensers: 50, trial: 30,
        features: ['10 stations', 'Owner + manager', 'Simple access control', 'Hardware fleet monitoring', 'SSO ready', 'Dedicated support'],
      },
    ];
    const planIds: Record<string, string> = {};
    for (const plan of planSpecs) {
      const id = newId('pln');
      planIds[plan.code] = id;
      run(
        `INSERT INTO subscription_plans
          (id, code, name, description, monthly_price, annual_price, max_stations, max_users, max_dispensers, features, trial_days, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, plan.code, plan.name, plan.desc, plan.price, plan.annual, plan.stations, plan.users,
          plan.dispensers, JSON.stringify(plan.features), plan.trial, nowIso(), nowIso()],
      );
    }

    // ------------------------------------------------------------ tenants ---
    const tenantA = newId('tnt');
    const tenantB = newId('tnt');
    run(
      `INSERT INTO tenants (id, name, slug, legal_name, gstin, contact_email, contact_phone, address, city, state, status, notes, is_demo, created_at, updated_at)
       VALUES (?, 'Sunrise Fuels Pvt Ltd', 'sunrise-fuels', 'Sunrise Fuels Private Limited', '27AABCS1234F1Z5',
               'ops@sunrisefuels.in', '+91 98200 11223', 'Baner Road, Pune', 'Pune', 'Maharashtra', 'ACTIVE',
               'Demo tenant — multi-station operator', 1, ?, ?)`,
      [tenantA, nowIso(), nowIso()],
    );
    if (legacyTestFixtures) run(
      `INSERT INTO tenants (id, name, slug, legal_name, gstin, contact_email, contact_phone, address, city, state, status, notes, is_demo, created_at, updated_at)
       VALUES (?, 'Highway Energy LLP', 'highway-energy', 'Highway Energy LLP', '27AAEFH9876K1Z2',
               'owner@highwayenergy.in', '+91 97650 44321', 'NH-48, Khed Shivapur', 'Pune', 'Maharashtra', 'ACTIVE',
               'Demo tenant — trial account', 1, ?, ?)`,
      [tenantB, nowIso(), nowIso()],
    );

    const subA = newId('sub');
    const subB = newId('sub');
    run(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, ends_at, trial_ends_at, seats, auto_renew, created_at, updated_at)
       VALUES (?, ?, ?, 'ACTIVE', ?, ?, NULL, 2, 1, ?, ?)`,
      [subA, tenantA, planIds.GROWTH, new Date(Date.now() - 120 * 86_400_000).toISOString(),
        new Date(Date.now() + 245 * 86_400_000).toISOString(), nowIso(), nowIso()],
    );
    if (legacyTestFixtures) run(
      `INSERT INTO subscriptions (id, tenant_id, plan_id, status, starts_at, ends_at, trial_ends_at, seats, auto_renew, created_at, updated_at)
       VALUES (?, ?, ?, 'TRIALING', ?, ?, ?, 8, 1, ?, ?)`,
      [subB, tenantB, planIds.STARTER, new Date(Date.now() - 5 * 86_400_000).toISOString(),
        new Date(Date.now() + 9 * 86_400_000).toISOString(), new Date(Date.now() + 9 * 86_400_000).toISOString(), nowIso(), nowIso()],
    );

    // Subscription invoices (platform billing, not fuel sales)
    const invoiceSpecs = [
      { monthsAgo: 2, status: 'PAID' },
      { monthsAgo: 1, status: 'PAID' },
      { monthsAgo: 0, status: 'ISSUED' },
    ];
    invoiceSpecs.forEach((spec, index) => {
      const base = new Date();
      base.setMonth(base.getMonth() - spec.monthsAgo);
      const periodStart = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-01`;
      const periodEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0).toISOString().slice(0, 10);
      const amount = D('7499.00');
      const tax = amount.mul(0.18);
      run(
        `INSERT INTO subscription_invoices
          (id, tenant_id, subscription_id, invoice_number, period_start, period_end, amount, tax_amount, total_amount,
           status, issued_at, due_at, paid_at, payment_method, payment_reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId('inv'), tenantA, subA, `PF-${periodStart.replace('-', '')}-${String(index + 1).padStart(4, '0')}`,
          periodStart, periodEnd, money(amount), money(tax), money(amount.plus(tax)), spec.status,
          new Date(`${periodStart}T00:00:00+05:30`).toISOString(),
          new Date(`${periodStart}T00:00:00+05:30`).getTime() + 7 * 86_400_000 > Date.now()
            ? new Date(Date.now() + 7 * 86_400_000).toISOString()
            : new Date(new Date(`${periodStart}T00:00:00+05:30`).getTime() + 7 * 86_400_000).toISOString(),
          spec.status === 'PAID' ? new Date(`${periodStart}T00:00:00+05:30`).getTime() + 3 * 86_400_000 > Date.now()
            ? nowIso() : new Date(new Date(`${periodStart}T00:00:00+05:30`).getTime() + 3 * 86_400_000).toISOString()
            : null,
          spec.status === 'PAID' ? 'BANK' : null,
          spec.status === 'PAID' ? `NEFT-${periodStart.replace(/-/g, '')}-${index + 1}` : null,
          nowIso()],
      );
    });

    // --------------------------------------------------------- stations -----
    const stations = [
      { id: newId('stn'), tenant: tenantA, code: 'SUN-BAN', name: 'Sunrise Fuels — Baner', city: 'Pune', state: 'Maharashtra', address: 'Baner Road, Pune' },
      { id: newId('stn'), tenant: tenantA, code: 'SUN-HIN', name: 'Sunrise Fuels — Hinjewadi', city: 'Pune', state: 'Maharashtra', address: 'Phase 2, Hinjewadi, Pune' },
      { id: newId('stn'), tenant: tenantB, code: 'HWE-KSP', name: 'Highway Energy — Khed Shivapur', city: 'Pune', state: 'Maharashtra', address: 'NH-48, Khed Shivapur' },
    ];
    for (const station of stations.filter((s) => legacyTestFixtures || s.tenant === tenantA)) {
      run(
        `INSERT INTO stations (id, tenant_id, code, name, address, city, state, pincode, timezone, status, opening_date, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '411045', 'Asia/Kolkata', 'ACTIVE', ?, 1, ?, ?)`,
        [station.id, station.tenant, station.code, station.name, station.address, station.city, station.state,
          addDays(businessDate(300), 0), nowIso(), nowIso()],
      );
    }
    const [stationA, stationB, stationC] = stations;

    // ------------------------------------------------------------- users ----
    const ownerUser = { id: newId('usr'), tenant: tenantA, email: 'owner@sunrisefuels.in', name: 'Rohit Deshmukh', role: 'OWNER', stations: [stationA.id, stationB.id] };
    const managerUser = { id: newId('usr'), tenant: tenantA, email: 'manager@sunrisefuels.in', name: 'Anjali Kulkarni', role: 'MANAGER', stations: legacyTestFixtures ? [stationA.id] : [stationA.id, stationB.id] };
    const otherOwner = { id: newId('usr'), tenant: tenantB, email: 'owner@highwayenergy.in', name: 'Vikram Patil', role: 'OWNER', stations: [stationC.id] };
    const platformUser = { id: newId('usr'), tenant: null, email: 'superadmin@petroflow.dev', name: 'Platform Administrator', role: 'SUPER_ADMIN', stations: [] as string[] };
    const userSpecs = [platformUser, ownerUser, managerUser, ...(legacyTestFixtures ? [otherOwner] : [])];
    for (const user of userSpecs) {
      run(
        `INSERT INTO users (id, tenant_id, email, name, phone, password_hash, role_key, status, must_change_password, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 1, ?, ?)`,
        [user.id, user.tenant, user.email, user.name, '+91 98200 00000', hashPassword(DEMO_PASSWORD),
          user.role, nowIso(), nowIso()],
      );
      for (const stationId of user.stations) {
        run(
          'INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, ?, ?)',
          [newId('usa'), user.id, stationId, '[]', nowIso()],
        );
      }
    }
    const ownerA = userSpecs[1].id;
    const managerA = managerUser.id;
    const cashierA = managerA;
    const ownerB = otherOwner.id;

    // ---------------------------------------------------------- products ----
    const productSpecs = [
      { tenant: tenantA, code: 'MS', name: 'Petrol (MS)', category: 'PETROL', color: '#ea580c', rate: '106.31', prevRate: '105.94' },
      { tenant: tenantA, code: 'HSD', name: 'Diesel (HSD)', category: 'DIESEL', color: '#15803d', rate: '94.27', prevRate: '93.88' },
      { tenant: tenantA, code: 'XP95', name: 'Power Petrol XP95', category: 'PETROL', color: '#ca8a04', rate: '112.45', prevRate: '111.80' },
      { tenant: tenantB, code: 'MS', name: 'Petrol (MS)', category: 'PETROL', color: '#ea580c', rate: '107.05', prevRate: '106.60' },
      { tenant: tenantB, code: 'HSD', name: 'Diesel (HSD)', category: 'DIESEL', color: '#15803d', rate: '95.12', prevRate: '94.75' },
    ];
    const productIds: Record<string, string> = {};
    for (const product of productSpecs.filter((p) => legacyTestFixtures || p.tenant === tenantA)) {
      const id = newId('prd');
      productIds[`${product.tenant}:${product.code}`] = id;
      run(
        `INSERT INTO fuel_products (id, tenant_id, code, name, category, unit, color, is_active, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'L', ?, 1, 1, ?, ?)`,
        [id, product.tenant, product.code, product.name, product.category, product.color, nowIso(), nowIso()],
      );
      // historical + current price with effective timestamps
      run(
        `INSERT INTO fuel_prices (id, tenant_id, product_id, station_id, rate_per_litre, effective_from, effective_to, note, created_by, is_demo, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, 'Previous price revision', ?, 1, ?)`,
        [newId('fpr'), product.tenant, id, fmtRate(product.prevRate),
          isoAt(businessDate(20), 6), isoAt(businessDate(8), 6), ownerA, nowIso()],
      );
      run(
        `INSERT INTO fuel_prices (id, tenant_id, product_id, station_id, rate_per_litre, effective_from, effective_to, note, created_by, is_demo, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, NULL, 'Latest revision', ?, 1, ?)`,
        [newId('fpr'), product.tenant, id, fmtRate(product.rate), isoAt(businessDate(8), 6), ownerA, nowIso()],
      );
    }
    const msA = productIds[`${tenantA}:MS`];
    const hsdA = productIds[`${tenantA}:HSD`];
    const xpA = productIds[`${tenantA}:XP95`];
    const msB = productIds[`${tenantB}:MS`];
    const hsB = productIds[`${tenantB}:HSD`];

    // ------------------------------------------------------------- tanks ----
    const tankSpecs = [
      { station: stationA, tenant: tenantA, code: 'T1', name: 'Petrol Tank 1', product: msA, capacity: '20000', opening: '14800' },
      { station: stationA, tenant: tenantA, code: 'T2', name: 'Diesel Tank 1', product: hsdA, capacity: '25000', opening: '19600' },
      { station: stationA, tenant: tenantA, code: 'T3', name: 'XP95 Tank', product: xpA, capacity: '10000', opening: '7200' },
      { station: stationB, tenant: tenantA, code: 'T1', name: 'Petrol Tank 1', product: msA, capacity: '20000', opening: '12000' },
      { station: stationB, tenant: tenantA, code: 'T2', name: 'Diesel Tank 1', product: hsdA, capacity: '20000', opening: '15000' },
      { station: stationC, tenant: tenantB, code: 'T1', name: 'Petrol Tank 1', product: msB, capacity: '15000', opening: '9000' },
      { station: stationC, tenant: tenantB, code: 'T2', name: 'Diesel Tank 1', product: hsB, capacity: '15000', opening: '11000' },
    ];
    const tankIds: Record<string, string> = {};
    for (const tank of tankSpecs.filter((t) => legacyTestFixtures || t.tenant === tenantA)) {
      const id = newId('tnk');
      tankIds[`${tank.station.id}:${tank.code}`] = id;
      run(
        `INSERT INTO tanks (id, station_id, code, name, product_id, capacity_litres, dead_stock_litres, calibration_reference, status, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '500', 'Manufacturer dip chart rev-2', 'ACTIVE', 1, ?, ?)`,
        [id, tank.station.id, tank.code, tank.name, tank.product, tank.capacity, nowIso(), nowIso()],
      );
      run(
        `INSERT INTO stock_movements
          (id, tenant_id, station_id, tank_id, product_id, type, quantity_litres, reference_type, reference_id,
           occurred_at, note, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, 'OPENING', ?, 'MANUAL', NULL, ?, 'Opening stock (demo)', 1, ?)`,
        [newId('mov'), tank.tenant, tank.station.id, id, tank.product, tank.opening,
          isoAt(businessDate(30), 5), nowIso()],
      );
      // calibration points every 25 cm
      for (let dip = 25; dip <= 200; dip += 25) {
        const frac = dip / 200;
        const litresAtDip = D(tank.capacity).mul(frac * frac * 0.85 + frac * 0.15);
        run(
          'INSERT INTO tank_calibration_points (id, tank_id, dip_cm, litres) VALUES (?, ?, ?, ?)',
          [newId('cal'), id, String(dip), fmtLitres(litresAtDip)],
        );
      }
    }

    // -------------------------------------------------------- dispensers ----
    const dispenserSpecs = [
      { station: stationA, code: 'D1', name: 'Dispenser 1', model: 'Gilbarco Encore S', serial: 'GB-2022-00118', protocol: 'SIMULATED' },
      { station: stationA, code: 'D2', name: 'Dispenser 2', model: 'Tokheim Quantium 510', serial: 'TK-2021-00472', protocol: 'SIMULATED' },
      { station: stationB, code: 'D1', name: 'Dispenser 1', model: 'Gilbarco Encore S', serial: 'GB-2023-00209', protocol: 'SIMULATED' },
      { station: stationC, code: 'D1', name: 'Dispenser 1', model: 'Wayne Helix', serial: 'WN-2020-00981', protocol: 'SIMULATED' },
    ];
    const dispenserIds: Record<string, string> = {};
    for (const dispenser of dispenserSpecs.filter((d) => legacyTestFixtures || d.station.tenant === tenantA)) {
      const id = newId('dsp');
      dispenserIds[`${dispenser.station.id}:${dispenser.code}`] = id;
      run(
        `INSERT INTO dispensers (id, station_id, code, name, model, serial_number, protocol, status, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 1, ?, ?)`,
        [id, dispenser.station.id, dispenser.code, dispenser.name, dispenser.model, dispenser.serial,
          dispenser.protocol, nowIso(), nowIso()],
      );
    }

    const nozzleSpecs = [
      { station: stationA, tenant: tenantA, dispenser: 'D1', number: 1, label: 'N1 · MS', product: msA },
      { station: stationA, tenant: tenantA, dispenser: 'D1', number: 2, label: 'N2 · HSD', product: hsdA },
      { station: stationA, tenant: tenantA, dispenser: 'D2', number: 1, label: 'N3 · XP95', product: xpA },
      { station: stationA, tenant: tenantA, dispenser: 'D2', number: 2, label: 'N4 · HSD', product: hsdA },
      { station: stationB, tenant: tenantA, dispenser: 'D1', number: 1, label: 'N1 · MS', product: msA },
      { station: stationB, tenant: tenantA, dispenser: 'D1', number: 2, label: 'N2 · HSD', product: hsdA },
      { station: stationC, tenant: tenantB, dispenser: 'D1', number: 1, label: 'N1 · MS', product: msB },
      { station: stationC, tenant: tenantB, dispenser: 'D1', number: 2, label: 'N2 · HSD', product: hsB },
    ];
    const nozzles: SeededNozzle[] = [];
    nozzleSpecs.filter((n) => legacyTestFixtures || n.tenant === tenantA).forEach((spec, index) => {
      const dispenserId = dispenserIds[`${spec.station.id}:${spec.dispenser}`];
      const id = newId('noz');
      run(
        `INSERT INTO nozzles (id, station_id, dispenser_id, product_id, number, label, totalizer_unit, status, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'L', 'ACTIVE', 1, ?, ?)`,
        [id, spec.station.id, dispenserId, spec.product, spec.number, spec.label, nowIso(), nowIso()],
      );
      nozzles.push({
        id, stationId: spec.station.id, tenantId: spec.tenant, productId: spec.product,
        dispenserId, dispenserCode: spec.dispenser, number: spec.number, label: spec.label,
        deviceId: '', totalizer: D(50000 + index * 4200 + Math.floor(randBetween(1000, 9000))), sequence: 0,
      });
    });

    // Nozzle -> fix tank mapping: har nozzle apne product wale pehle tank se
    // juda hai (asli pump par pipe aise hi lagta hai). Isse shift ki dispensed
    // stock seedha sahi tank par girti hai, pro-rata andaz nahi lagta.
    run(
      `UPDATE nozzles SET tank_id = (
         SELECT t.id FROM tanks t
          WHERE t.station_id = nozzles.station_id AND t.product_id = nozzles.product_id
          ORDER BY t.code LIMIT 1
       ) WHERE tank_id IS NULL`,
    );

    // ------------------------------------------------------------ devices ---
    const deviceSpecs = [
      { station: stationA, tenant: tenantA, code: 'GW-BAN-01', name: 'Baner Gateway 01', serial: 'PFGW-0001' },
      { station: stationB, tenant: tenantA, code: 'GW-HIN-01', name: 'Hinjewadi Gateway 01', serial: 'PFGW-0002' },
      { station: stationC, tenant: tenantB, code: 'GW-KSP-01', name: 'Khed Shivapur Gateway 01', serial: 'PFGW-0003' },
    ];
    const deviceIds: Record<string, string> = {};
    for (const device of deviceSpecs.filter((d) => legacyTestFixtures || d.tenant === tenantA)) {
      const secret = createHash('sha256').update(`${device.code}-${Math.random()}`).digest('base64url').slice(0, 24);
      const prefix = createHash('sha256').update(device.code).digest('hex').slice(0, 12);
      const id = newId('dev');
      deviceIds[device.station.id] = id;
      run(
        `INSERT INTO hardware_devices
          (id, tenant_id, station_id, code, name, type, vendor, model, serial_number, protocol, status,
           api_key_hash, api_key_prefix, key_version, last_heartbeat_at, last_sync_at, firmware_version, is_simulated, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'GATEWAY', 'PetroFlow Simulator', 'PF-SIM-100', ?, 'PetroFlow Simulator Protocol v1', 'ONLINE',
                 ?, ?, 1, ?, ?, 'sim-1.4.2', 1, 'Demo simulator gateway — not connected to physical hardware', ?, ?)`,
        [id, device.tenant, device.station.id, device.code, device.name, device.serial,
          createHash('sha256').update(secret).digest('hex'), prefix, nowIso(), nowIso(), nowIso(), nowIso()],
      );
      run(
        `INSERT INTO device_credentials (id, device_id, key_prefix, secret_hash, version, status, created_at)
         VALUES (?, ?, ?, ?, 1, 'ACTIVE', ?)`,
        [newId('dcd'), id, prefix, createHash('sha256').update(secret).digest('hex'), nowIso()],
      );
      for (const nozzle of nozzles.filter((n) => n.stationId === device.station.id)) {
        nozzle.deviceId = id;
      }
    }

    // --------------------------------------------------- meter + event feed -
    const priceFor = (tenantId: string, productId: string) =>
      get<{ rate_per_litre: string }>(
        `SELECT rate_per_litre FROM fuel_prices WHERE tenant_id = ? AND product_id = ? ORDER BY effective_from DESC LIMIT 1`,
        [tenantId, productId],
      )?.rate_per_litre ?? '0';

    const readingsByNode = new Map<string, { value: string; at: string; id: string }>();
    // The demo tenant runs two outlets (Baner + Hinjewadi); both must carry data.
    const seededNozzles = nozzles.filter((n) => n.tenantId === tenantA || n.tenantId === tenantB);
    const tenantANozzles = seededNozzles;
    const nozzlesOf = (stationId: string) => seededNozzles.filter((n) => n.stationId === stationId);

    for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
      const date = businessDate(dayOffset);
      const hours = dayOffset === 0 ? [6, 11] : [6, 12, 18];
      for (const hour of hours) {
        const at = isoAt(date, hour, Math.floor(randBetween(0, 50)));
        // Never seed a totalizer reading in the future: a later-dated row would
        // make every genuine device event look out of order.
        if (new Date(at).getTime() > Date.now()) continue;
        for (const nozzle of seededNozzles) {
          const increment = D(randBetween(60, 320));
          nozzle.totalizer = nozzle.totalizer.plus(increment);
          nozzle.sequence += 1;
          const previous = readingsByNode.get(nozzle.id);
          const readingId = newId('mrd');
          const eventId = newId('evt');
          const externalId = `SIM-${date.replace(/-/g, '')}-${nozzle.dispenserCode}-${nozzle.number}-${nozzle.sequence}`;
          const payload = {
            eventId: externalId, type: 'TOTALIZER_SNAPSHOT', sequence: nozzle.sequence, occurredAt: at,
            dispenserCode: nozzle.dispenserCode, nozzleNumber: nozzle.number,
            value: fmtLitres(nozzle.totalizer), unit: 'L', _source: 'SIMULATOR',
          };
          run(
            `INSERT INTO device_events
              (id, tenant_id, station_id, device_id, event_id, event_type, sequence, occurred_at, received_at,
               payload, payload_hash, status, processed_at, source_ip)
             VALUES (?, ?, ?, ?, ?, 'TOTALIZER_SNAPSHOT', ?, ?, ?, ?, ?, 'PROCESSED', ?, '127.0.0.1')`,
            [eventId, nozzle.tenantId, nozzle.stationId, nozzle.deviceId, externalId, nozzle.sequence, at, at,
              JSON.stringify(payload), createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
              at],
          );
          run(
            `INSERT INTO meter_readings
              (id, tenant_id, station_id, nozzle_id, device_id, device_event_id, reading_value, unit, source,
               quality, reading_at, sequence, delta_litres, previous_reading_id, is_countable, is_simulated, note, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'L', 'SIMULATOR', 'VALID', ?, ?, ?, ?, 1, 1, 'SIMULATED reading from demo gateway', ?)`,
            [readingId, nozzle.tenantId, nozzle.stationId, nozzle.id, nozzle.deviceId, eventId, fmtLitres(nozzle.totalizer),
              at, nozzle.sequence, previous ? fmtLitres(increment) : null, previous?.id ?? null, at],
          );
          readingsByNode.set(nozzle.id, { value: fmtLitres(nozzle.totalizer), at, id: readingId });
        }
      }
    }

    // ------------------------------------------------------------- shifts ---
    const seededOutlets = [
      { station: stationA, tenant: tenantA, operator: cashierA, approver: ownerA },
      { station: stationB, tenant: tenantA, operator: managerA, approver: ownerA },
      { station: stationC, tenant: tenantB, operator: ownerB, approver: ownerB },
    ];
    for (let dayOffset = 6; dayOffset >= 1; dayOffset -= 1) {
      const date = businessDate(dayOffset);
      for (const [outletIndex, outlet] of seededOutlets.filter((o) => legacyTestFixtures || o.tenant === tenantA).entries()) {
        const stationRow = outlet.station;
        // Only the first Sunrise outlet carries the demo variance/flag scenario.
        const flagged = dayOffset === 2 && outletIndex === 0;
        const shiftId = newId('shf');
        let totalLitres = D(0);
        let totalValue = D(0);
        run(
          `INSERT INTO shifts
            (id, tenant_id, station_id, shift_number, business_date, opened_at, closed_at, operator_id, opened_by,
             closed_by, status, opening_cash, closing_cash, notes, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '5000', '5000', 'Demo shift', 1, ?, ?)`,
          [shiftId, outlet.tenant, stationRow.id, date, isoAt(date, 6), isoAt(date, 18), outlet.operator, outlet.operator,
            outlet.operator, flagged ? 'FLAGGED' : 'CLOSED', nowIso(), nowIso()],
        );
        for (const nozzle of nozzlesOf(stationRow.id)) {
          const readings = all<Record<string, unknown>>(
            `SELECT id, reading_value, reading_at, source FROM meter_readings
              WHERE nozzle_id = ? AND reading_at >= ? AND reading_at <= ? ORDER BY reading_at`,
            [nozzle.id, isoAt(date, 0), isoAt(date, 23)],
          );
          if (readings.length < 2) continue;
          const first = readings[0];
          const last = readings[readings.length - 1];
          const opening = first.reading_value as string;
          let closing = last.reading_value as string;
          let variance: string | null = null;
          let status = 'CAPTURED';
          if (flagged && nozzle.number === 1) {
            closing = D(closing).plus('3.500').toFixed(3);
            variance = '3.500';
            status = 'FLAGGED';
          }
          const qty = D(closing).minus(opening);
          const rate = D(priceFor(outlet.tenant, nozzle.productId));
          run(
            `INSERT INTO shift_nozzle_readings
              (id, shift_id, nozzle_id, opening_reading, closing_reading, opening_reading_id, closing_reading_id,
               opening_source, closing_source, litres_sold, rate, sales_value, variance_litres, status, note, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'SIMULATOR', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [newId('snr'), shiftId, nozzle.id, opening, closing, String(first.id), String(last.id),
              flagged && nozzle.number === 1 ? 'MANUAL' : 'SIMULATOR', fmtLitres(qty), fmtRate(rate),
              money(qty.mul(rate)), variance, status, variance ? 'Manual closing differs from device reading' : null,
              nowIso(), nowIso()],
          );
          totalLitres = totalLitres.plus(qty);
          totalValue = totalValue.plus(qty.mul(rate));
        }
        run('UPDATE shifts SET total_litres = ?, total_value = ?, approved_by = ?, approved_at = ? WHERE id = ?', [
          fmtLitres(totalLitres), money(totalValue), flagged ? null : outlet.approver,
          flagged ? null : isoAt(date, 19), shiftId,
        ]);
        // aggregate stock out by product
        const outletProducts = new Set(nozzlesOf(stationRow.id).map((n) => n.productId));
        for (const productId of outletProducts) {
          const sum = all<{ litres: string | null }>(
            `SELECT SUM(CAST(snr.litres_sold AS REAL)) AS litres FROM shift_nozzle_readings snr
               JOIN nozzles n ON n.id = snr.nozzle_id
              WHERE snr.shift_id = ? AND n.product_id = ?`,
            [shiftId, productId],
          )[0]?.litres;
          if (sum && Number(sum) > 0) {
            const tank = get<{ id: string }>(
              'SELECT id FROM tanks WHERE station_id = ? AND product_id = ?',
              [stationRow.id, productId],
            );
            if (!tank) continue;
            run(
              `INSERT INTO stock_movements
                (id, tenant_id, station_id, tank_id, product_id, type, quantity_litres, reference_type, reference_id,
                 occurred_at, note, is_demo, created_at)
               VALUES (?, ?, ?, ?, ?, 'DISPENSED', ?, 'SHIFT', ?, ?, 'Aggregate dispensed (demo)', 1, ?)`,
              [newId('mov'), outlet.tenant, stationRow.id, tank.id, productId, fmtLitres(D(sum)), shiftId,
                isoAt(date, 18), nowIso()],
            );
          }
        }
      }
    }

    // Open shift for today at every seeded outlet
    const today = businessDate(0);
    for (const outlet of seededOutlets.filter((o) => legacyTestFixtures || o.tenant === tenantA)) {
      const stationRow = outlet.station;
      const openShiftId = newId('shf');
      run(
        `INSERT INTO shifts
          (id, tenant_id, station_id, shift_number, business_date, opened_at, operator_id, opened_by, status,
           opening_cash, notes, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?, ?, 'OPEN', '8000', 'Current day shift', 1, ?, ?)`,
        [openShiftId, outlet.tenant, stationRow.id, today, nowIso(), outlet.operator, outlet.operator, nowIso(), nowIso()],
      );
      for (const nozzle of nozzlesOf(stationRow.id)) {
        const last = readingsByNode.get(nozzle.id);
        run(
          `INSERT INTO shift_nozzle_readings
            (id, shift_id, nozzle_id, opening_reading, opening_reading_id, opening_source, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'SIMULATOR', 'PENDING', ?, ?)`,
          [newId('snr'), openShiftId, nozzle.id, last?.value ?? null, last?.id ?? null, nowIso(), nowIso()],
        );
      }
    }

    // -------------------------------------------------------- stock receipts
    const suppliers = [
      { id: newId('sup'), tenant: tenantA, code: 'IOCL', name: 'Indian Oil Corporation Ltd', gstin: '27AAACI1681G1ZM', phone: '+91 22 2644 0000', opening: '0' },
      { id: newId('sup'), tenant: tenantA, code: 'BPCL', name: 'Bharat Petroleum Corporation Ltd', gstin: '27AAACB2902M1ZS', phone: '+91 22 2271 3000', opening: '0' },
      { id: newId('sup'), tenant: tenantB, code: 'HPCL', name: 'Hindustan Petroleum Corporation Ltd', gstin: '27AAACH1118B1ZB', phone: '+91 22 2286 3000', opening: '0' },
    ];
    for (const supplier of suppliers.filter((s) => legacyTestFixtures || s.tenant === tenantA)) {
      run(
        `INSERT INTO suppliers (id, tenant_id, code, name, gstin, contact_person, phone, email, address, credit_days, opening_balance, is_active, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Depot Sales', ?, ?, 'Pune Depot', 15, ?, 1, 1, ?, ?)`,
        [supplier.id, supplier.tenant, supplier.code, supplier.name, supplier.gstin, supplier.phone,
          `${supplier.code.toLowerCase()}@depot.example`, supplier.opening, nowIso(), nowIso()],
      );
    }

    const deliverySpecs = [
      { day: 5, station: stationA, supplier: suppliers[0], tank: tankIds[`${stationA.id}:T1`], product: msA, qty: '3000', rate: '102.10' },
      { day: 3, station: stationA, supplier: suppliers[0], tank: tankIds[`${stationA.id}:T2`], product: hsdA, qty: '4000', rate: '90.40' },
      { day: 3, station: stationB, supplier: suppliers[1], tank: tankIds[`${stationB.id}:T1`], product: msA, qty: '2000', rate: '102.20' },
      { day: 1, station: stationA, supplier: suppliers[1], tank: tankIds[`${stationA.id}:T1`], product: msA, qty: '2500', rate: '102.35' },
      { day: 1, station: stationB, supplier: suppliers[0], tank: tankIds[`${stationB.id}:T2`], product: hsdA, qty: '3500', rate: '90.55' },
    ];
    for (const delivery of deliverySpecs) {
      const date = businessDate(delivery.day);
      const qty = D(delivery.qty);
      const rate = D(delivery.rate);
      const taxable = qty.mul(rate);
      const tax = taxable.mul('0.0');
      const id = newId('dlv');
      run(
        `INSERT INTO deliveries
          (id, tenant_id, station_id, supplier_id, invoice_number, invoice_date, product_id, tank_id, quantity_litres,
           received_litres, rate_per_litre, taxable_amount, tax_amount, total_amount, status, received_at,
           vehicle_number, driver_name, notes, is_demo, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, 'Demo driver', 'Demo delivery', 1, ?, ?, ?)`,
        [id, tenantA, delivery.station.id, delivery.supplier.id, `INV-${date.replace(/-/g, '')}-${delivery.tank.slice(-2)}`,
          date, delivery.product, delivery.tank, fmtLitres(qty), fmtLitres(qty), fmtRate(rate), money(taxable),
          money(tax), money(taxable.plus(tax)), isoAt(date, 7), `MH12AB${Math.floor(randBetween(1000, 9999))}`,
          ownerA, nowIso(), nowIso()],
      );
      run(
        `INSERT INTO stock_movements
          (id, tenant_id, station_id, tank_id, product_id, type, quantity_litres, reference_type, reference_id,
           occurred_at, note, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, 'DELIVERY', ?, 'DELIVERY', ?, ?, 'Tank truck delivery (demo)', 1, ?)`,
        [newId('mov'), tenantA, delivery.station.id, delivery.tank, delivery.product, fmtLitres(qty), id, isoAt(date, 7), nowIso()],
      );
    }

    // ----------------------------------------------------------- customers --
    const customerSpecs = [
      { tenant: tenantA, code: 'CUST-001', name: 'Sahyadri Logistics Pvt Ltd', phone: '+91 98220 11001', limit: '200000', days: 30 },
      { tenant: tenantA, code: 'CUST-002', name: 'Pune City Cabs', phone: '+91 98220 11002', limit: '50000', days: 15 },
      { tenant: tenantA, code: 'CUST-003', name: 'Greenfield Agro Farms', phone: '+91 98220 11003', limit: '100000', days: 21 },
      { tenant: tenantB, code: 'CUST-001', name: 'NH-48 Transporters', phone: '+91 97650 33001', limit: '75000', days: 15 },
    ];
    const customers: Record<string, string> = {};
    for (const customer of customerSpecs.filter((c) => legacyTestFixtures || c.tenant === tenantA)) {
      const id = newId('cus');
      customers[customer.code] = id;
      run(
        `INSERT INTO customers (id, tenant_id, code, name, phone, email, gstin, address, credit_limit, credit_days, balance, status, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Pune, Maharashtra', ?, ?, '0', 'ACTIVE', 1, ?, ?)`,
        [id, customer.tenant, customer.code, customer.name, customer.phone,
          `${customer.code.toLowerCase()}@customer.example`, '27AAAPL1234C1Z9', customer.limit,
          customer.days, nowIso(), nowIso()],
      );
    }

    const creditSales = [
      { day: 4, station: stationA, customer: 'CUST-001', product: msA, qty: '120', mode: 'CREDIT' },
      { day: 3, station: stationB, customer: 'CUST-002', product: msA, qty: '45', mode: 'CREDIT' },
      { day: 3, station: stationB, customer: 'CUST-001', product: hsdA, qty: '180', mode: 'CASH' },
      { day: 2, station: stationA, customer: 'CUST-003', product: hsdA, qty: '310', mode: 'CREDIT' },
      { day: 1, station: stationA, customer: 'CUST-001', product: hsdA, qty: '260', mode: 'CREDIT' },
      { day: 0, station: stationB, customer: 'CUST-002', product: msA, qty: '38', mode: 'UPI' },
    ];
    for (const sale of creditSales) {
      const date = businessDate(sale.day);
      const at = isoAt(date, 11, 20);
      const rate = D(priceFor(tenantA, sale.product));
      const qty = D(sale.qty);
      const amount = qty.mul(rate);
      const txId = newId('ftx');
      const reference = `DEMO-${date.replace(/-/g, '')}-${txId.slice(-6).toUpperCase()}`;
      run(
        `INSERT INTO fuel_transactions
          (id, tenant_id, station_id, shift_id, nozzle_id, product_id, quantity_litres, rate, amount, payment_mode,
           customer_id, occurred_at, reference, source, is_estimated, is_demo, created_by, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 0, 1, ?, ?)`,
        [txId, tenantA, sale.station.id, sale.product, fmtLitres(qty), fmtRate(rate), money(amount), sale.mode,
          customers[sale.customer], at, reference, cashierA, nowIso()],
      );
      if (sale.mode === 'CREDIT') {
        run(
          `INSERT INTO credit_entries
            (id, tenant_id, station_id, customer_id, type, amount, reference, occurred_at, due_date, transaction_id,
             note, status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'CREDIT_SALE', ?, ?, ?, ?, ?, 'Demo credit sale', 'POSTED', ?, ?)`,
          [newId('cle'), tenantA, sale.station.id, customers[sale.customer], money(amount), reference, at,
            addDays(date, 15), txId, cashierA, nowIso()],
        );
      }
    }
    for (const code of ['CUST-001', 'CUST-002', 'CUST-003']) {
      const entries = all<{ amount: string }>('SELECT amount FROM credit_entries WHERE customer_id = ?', [customers[code]]);
      const balance = entries.reduce((acc, e) => acc.plus(D(e.amount)), D(0));
      run('UPDATE customers SET balance = ? WHERE id = ?', [money(balance), customers[code]]);
    }

    // Customer receipt
    const receiptId = newId('pay');
    const receiptAmount = D('6000.00');
    run(
      `INSERT INTO payments
        (id, tenant_id, station_id, direction, party_type, customer_id, amount, mode, reference, occurred_at,
         status, settlement_ref, settled_at, notes, created_by, is_demo, created_at)
       VALUES (?, ?, ?, 'RECEIPT', 'CUSTOMER', ?, ?, 'UPI', 'UPI-DEMO-7781', ?, 'SETTLED', 'UPI-SETTLE-7781', ?, 'Demo customer receipt', ?, 1, ?)`,
      [receiptId, tenantA, stationA.id, customers['CUST-001'], money(receiptAmount), isoAt(businessDate(1), 15),
        isoAt(businessDate(1), 15), cashierA, nowIso()],
    );
    run(
      `INSERT INTO credit_entries
        (id, tenant_id, station_id, customer_id, type, amount, reference, occurred_at, payment_id, note, status, created_by, created_at)
       VALUES (?, ?, ?, ?, 'PAYMENT', ?, 'UPI-DEMO-7781', ?, ?, 'Demo receipt', 'POSTED', ?, ?)`,
      [newId('cle'), tenantA, stationA.id, customers['CUST-001'], money(receiptAmount.negated()),
        isoAt(businessDate(1), 15), receiptId, cashierA, nowIso()],
    );
    {
      const entries = all<{ amount: string }>('SELECT amount FROM credit_entries WHERE customer_id = ?', [customers['CUST-001']]);
      const balance = entries.reduce((acc, e) => acc.plus(D(e.amount)), D(0));
      run('UPDATE customers SET balance = ? WHERE id = ?', [money(balance), customers['CUST-001']]);
    }

    // Supplier payouts
    for (const [index, amount] of ['250000.00', '180000.00'].entries()) {
      run(
        `INSERT INTO payments
          (id, tenant_id, station_id, direction, party_type, supplier_id, amount, mode, reference, occurred_at,
           status, settlement_ref, settled_at, notes, created_by, is_demo, created_at)
         VALUES (?, ?, ?, 'PAYOUT', 'SUPPLIER', ?, ?, 'BANK', ?, ?, 'SETTLED', ?, ?, 'Demo supplier payment', ?, 1, ?)`,
        [newId('pay'), tenantA, stationA.id, suppliers[index].id, amount, `NEFT-DEMO-${9000 + index}`,
          isoAt(businessDate(2 + index), 16), `NEFT-SETTLE-${9000 + index}`, isoAt(businessDate(2 + index), 16),
          ownerA, nowIso()],
      );
    }

    // ------------------------------------------------------------ expenses --
    const expenseCategories = ['Salaries', 'Electricity', 'Maintenance', 'Consumables', 'Transport'];
    const categoryIds: string[] = [];
    for (const name of expenseCategories) {
      const id = newId('exc');
      categoryIds.push(id);
      run(
        'INSERT INTO expense_categories (id, tenant_id, name, is_active) VALUES (?, ?, ?, 1)',
        [id, tenantA, name],
      );
    }
    const expenseSpecs = [
      { day: 4, station: stationA, category: 'Electricity', name: 'MSEDCL commercial bill', amount: '18450.00' },
      { day: 3, station: stationA, category: 'Maintenance', name: 'Nozzle calibration service', amount: '4200.00' },
      { day: 3, station: stationB, category: 'Electricity', name: 'MSEDCL bill — Hinjewadi', amount: '11200.00' },
      { day: 2, station: stationA, category: 'Salaries', name: 'Staff salary advance', amount: '25000.00' },
      { day: 1, station: stationB, category: 'Consumables', name: 'Billing rolls and stationery', amount: '1450.00' },
      { day: 1, station: stationA, category: 'Consumables', name: 'Billing rolls and stationery', amount: '1650.00' },
    ];
    for (const expense of expenseSpecs) {
      run(
        `INSERT INTO expenses
          (id, tenant_id, station_id, category_id, category_name, description, amount, occurred_at, paid_via,
           reference, note, created_by, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'BANK', ?, 'Demo expense', ?, 1, ?)`,
        [newId('exp'), tenantA, expense.station.id, categoryIds[expenseCategories.indexOf(expense.category)],
          expense.category, expense.name, expense.amount, isoAt(businessDate(expense.day), 14),
          `EXP-DEMO-${expense.day}`, ownerA, nowIso()],
      );
    }

    // ------------------------------------------------------ reconciliations --
    for (const stationRow of [stationA, stationB]) {
      run(
        `INSERT INTO reconciliations
          (id, tenant_id, station_id, business_date, type, cash_expected, cash_counted, digital_expected, digital_settled,
           variance, status, notes, created_by, approved_by, approved_at, created_at)
         VALUES (?, ?, ?, ?, 'CASH', '0.00', '0.00', '0.00', '0.00', '0.00', 'OPEN',
                 'Demo reconciliation — computed figures are shown on the reconciliation screen', ?, NULL, NULL, ?)`,
        [newId('rec'), tenantA, stationRow.id, businessDate(1), cashierA, nowIso()],
      );
    }

    // ---------------------------------------------------------- tank dips ---
    const dipVarianceByTank: Record<string, string> = {
      [`${stationA.id}:T1`]: '-14.500',
      [`${stationA.id}:T2`]: '9.000',
      [`${stationA.id}:T3`]: '-3.250',
      [`${stationB.id}:T1`]: '-6.750',
      [`${stationB.id}:T2`]: '4.250',
    };
    const tankStation = (tankKey: string) => (tankKey.startsWith(stationB.id) ? stationB : stationA);
    for (const tankKey of Object.keys(dipVarianceByTank)) {
      const tankId = tankIds[tankKey];
      const book = all<{ type: string; quantity_litres: string }>(
        'SELECT type, quantity_litres FROM stock_movements WHERE tank_id = ?',
        [tankId],
      ).reduce((acc, mov) => {
        const sign = ['OPENING', 'DELIVERY', 'TRANSFER_IN', 'ADJUSTMENT'].includes(mov.type) ? 1 : -1;
        return acc.plus(D(mov.quantity_litres).mul(sign));
      }, D(0));
      const measured = book.plus(dipVarianceByTank[tankKey]);
      run(
        `INSERT INTO tank_measurements
          (id, tenant_id, station_id, tank_id, measured_at, measured_litres, book_stock_litres, variance_litres,
           method, source, entered_by, note, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', 'MANUAL', ?, 'Demo physical dip', 1, ?)`,
        [newId('tms'), tenantA, tankStation(tankKey).id, tankId, isoAt(businessDate(0), 8), fmtLitres(measured), fmtLitres(book),
          dipVarianceByTank[tankKey], managerA, nowIso()],
      );
    }

    // -------------------------------------------- a rejected event + error ---
    run(
      `INSERT INTO device_events
        (id, tenant_id, station_id, device_id, event_id, event_type, sequence, occurred_at, received_at,
         payload, payload_hash, status, error, processed_at, source_ip)
       VALUES (?, ?, ?, ?, 'SIM-BAD-0001', 'TOTALIZER_SNAPSHOT', 0, ?, ?, ?, ?, 'REJECTED',
               'Unknown nozzle number 9 on D1', ?, '127.0.0.1')`,
      [newId('evt'), tenantA, stationA.id, deviceIds[stationA.id],
        isoAt(businessDate(1), 10), isoAt(businessDate(1), 10),
        JSON.stringify({ eventId: 'SIM-BAD-0001', type: 'TOTALIZER_SNAPSHOT', dispenserCode: 'D1', nozzleNumber: 9, value: '1000.000', unit: 'L' }),
        createHash('sha256').update('bad').digest('hex'), isoAt(businessDate(1), 10)],
    );
    run(
      `INSERT INTO device_error_logs (id, device_id, station_id, code, message, detail, created_at)
       VALUES (?, ?, ?, 'BUFFER_RETRY', 'Spool flush retried 2 buffered events after network recovery',
               'Connectivity to cloud restored at 18:42 IST', ?)`,
      [newId('der'), deviceIds[stationA.id], stationA.id, isoAt(businessDate(1), 18)],
    );
    run(
      `INSERT INTO device_error_logs (id, device_id, station_id, code, message, detail, created_at, resolved_at)
       VALUES (?, ?, ?, 'HEARTBEAT_MISSED', 'Gateway missed 3 heartbeats', 'ISP outage', ?, ?)`,
      [newId('der'), deviceIds[stationB.id], stationB.id, isoAt(businessDate(3), 9), isoAt(businessDate(3), 10)],
    );

    // ------------------------------------------------------------ settings --
    run(
      'INSERT INTO app_settings (id, tenant_id, station_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [newId('stg'), tenantA, '', 'hardware.maxJumpLitres', '10000', ownerA, nowIso()],
    );
    run(
      'INSERT INTO app_settings (id, tenant_id, station_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [newId('stg'), tenantA, '', 'shifts.unclosedAlertHours', '12', ownerA, nowIso()],
    );

    // ----------------------------------------------------------- audit log --
    // ------------------------------------------------- pump ops demo pack ---
    // Density register (last 5 din, Baner ke 3 tanks) — observed density ko
    // 15°C par correct karke dikhaya gaya hai, jaisa asli register me hota hai.
    {
      const densityPlan = [
        { tankKey: `${stationA.id}:T1`, product: msA, category: 'PETROL', observed: '738.4', temp: '31.0' },
        { tankKey: `${stationA.id}:T2`, product: hsdA, category: 'DIESEL', observed: '829.6', temp: '30.5' },
        { tankKey: `${stationA.id}:T3`, product: xpA, category: 'PETROL', observed: '745.1', temp: '31.5' },
      ];
      for (let dayAgo = 4; dayAgo >= 0; dayAgo -= 1) {
        for (const plan of densityPlan) {
          const wobble = (dayAgo % 3) * 0.4;
          const observed = D(plan.observed).plus(wobble).toFixed(1);
          const ev = evaluateDensity(plan.category, observed, plan.temp);
          run(
            `INSERT INTO density_checks
              (id, tenant_id, station_id, tank_id, product_id, business_date, checked_at, observed_density,
               observed_temp_c, density_at_15c, spec_min, spec_max, within_spec, source, checked_by, note, is_demo, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOZZLE', ?, 'Subah ki density check (demo)', 1, ?)`,
            [newId('den'), tenantA, stationA.id, tankIds[plan.tankKey], plan.product, businessDate(dayAgo),
              isoAt(businessDate(dayAgo), 7, 15), observed, plan.temp, ev.densityAt15c, ev.specMin, ev.specMax,
              ev.withinSpec ? 1 : 0, managerA ?? ownerA, nowIso()],
          );
        }
      }
    }

    // Compliance documents: ek W&M stamping jald expire, PESO theek-thak.
    {
      const banerD1 = dispenserIds[`${stationA.id}:D1`];
      const docs = [
        { type: 'PESO_LICENCE', title: 'PESO Storage Licence', number: 'PESO/WEST/2021/1187', authority: 'PESO Nagpur', issued: addDays(businessDate(0), -700), expires: addDays(businessDate(0), 400), dispenser: null as string | null, tank: null as string | null },
        { type: 'WM_STAMPING', title: 'Weights & Measures Stamping — D1', number: 'WM/PUNE/2026/4421', authority: 'Legal Metrology Pune', issued: addDays(businessDate(0), -350), expires: addDays(businessDate(0), 12), dispenser: banerD1, tank: null },
        { type: 'FIRE_NOC', title: 'Fire NOC', number: 'FNOC/PMC/2025/087', authority: 'Pune Fire Brigade', issued: addDays(businessDate(0), -200), expires: addDays(businessDate(0), 165), dispenser: null, tank: null },
        { type: 'TANK_TESTING', title: 'Tank T1 Pressure Testing', number: 'TT/2024/19', authority: 'Approved Testing Agency', issued: addDays(businessDate(0), -900), expires: addDays(businessDate(0), -15), dispenser: null, tank: tankIds[`${stationA.id}:T1`] },
        { type: 'TRADE_LICENCE', title: 'Trade Licence (Gumasta)', number: 'PMC/TL/2026/3310', authority: 'Pune Municipal Corporation', issued: addDays(businessDate(0), -100), expires: addDays(businessDate(0), 265), dispenser: null, tank: null },
      ];
      for (const doc of docs) {
        run(
          `INSERT INTO compliance_documents
            (id, tenant_id, station_id, dispenser_id, tank_id, doc_type, title, doc_number, authority,
             issued_on, expires_on, renewal_lead_days, notes, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 30, 'Demo compliance record', 1, ?, ?)`,
          [newId('cmp'), tenantA, stationA.id, doc.dispenser, doc.tank, doc.type, doc.title, doc.number,
            doc.authority, doc.issued, doc.expires, nowIso(), nowIso()],
        );
      }
    }

    // Credit customers ki gaadiyan (fleet).
    {
      const vehicles: [string, string, string, string][] = [
        ['CUST-001', 'MH12AB4521', 'Truck', 'Ramesh Mane'],
        ['CUST-001', 'MH12CD8890', 'Tempo', 'Vijay Shinde'],
        ['CUST-002', 'MH14EF2210', 'Pickup', 'Sanjay Patil'],
      ];
      for (const [code, number, type, driver] of vehicles) {
        if (!customers[code]) continue;
        run(
          `INSERT INTO customer_vehicles (id, tenant_id, customer_id, vehicle_number, vehicle_type, driver_name, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [newId('veh'), tenantA, customers[code], number, type, driver, nowIso(), nowIso()],
        );
      }
    }

    // Lubricants: catalog + opening stock + chand bikri.
    {
      const lubes = [
        { code: 'SERVO-4T-900', name: 'Servo 4T Bike Oil', brand: 'Servo', pack: '900 ml', buy: '285.00', sell: '340.00', opening: '48' },
        { code: 'HP-MILCY-15W40', name: 'HP Milcy Turbo 15W40', brand: 'HP', pack: '5 L', buy: '1420.00', sell: '1699.00', opening: '20' },
        { code: 'MAK-2T-500', name: 'MAK 2T Oil', brand: 'MAK', pack: '500 ml', buy: '150.00', sell: '185.00', opening: '60' },
        { code: 'DW-1L', name: 'Distilled Water', brand: 'Local', pack: '1 L', buy: '18.00', sell: '30.00', opening: '120' },
      ];
      for (const lube of lubes) {
        const id = newId('lub');
        run(
          `INSERT INTO lube_products (id, tenant_id, code, name, brand, pack_size, hsn_code, gst_rate_pct, purchase_rate, sale_rate, is_active, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '271019', '18', ?, ?, 1, 1, ?, ?)`,
          [id, tenantA, lube.code, lube.name, lube.brand, lube.pack, lube.buy, lube.sell, nowIso(), nowIso()],
        );
        run(
          `INSERT INTO lube_movements (id, tenant_id, station_id, product_id, type, quantity, rate, amount, occurred_at, note, created_by, is_demo, created_at)
           VALUES (?, ?, ?, ?, 'OPENING', ?, ?, ?, ?, 'Opening lubricant stock (demo)', ?, 1, ?)`,
          [newId('lum'), tenantA, stationA.id, id, lube.opening, lube.buy,
            money(D(lube.opening).mul(D(lube.buy))), isoAt(businessDate(10), 9), ownerA, nowIso()],
        );
        run(
          `INSERT INTO lube_movements (id, tenant_id, station_id, product_id, type, quantity, rate, amount, payment_mode, vehicle_number, occurred_at, note, created_by, is_demo, created_at)
           VALUES (?, ?, ?, ?, 'SALE', '-2.00', ?, ?, 'UPI', 'MH12XY7788', ?, 'Counter sale (demo)', ?, 1, ?)`,
          [newId('lum'), tenantA, stationA.id, id, lube.sell, money(D(lube.sell).mul(2)),
            isoAt(businessDate(1), 13), cashierA ?? ownerA, nowIso()],
        );
      }
    }

    // Aaj ki attendance (Baner team).
    {
      const team = [managerA].filter(Boolean) as string[];
      for (const userId of team) {
        run(
          `INSERT INTO attendance_records (id, tenant_id, station_id, user_id, attendance_date, status, in_time, note, marked_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'PRESENT', '07:00', NULL, ?, ?, ?)`,
          [newId('att'), tenantA, stationA.id, userId, businessDate(0), ownerA, nowIso(), nowIso()],
        );
      }
    }

    const auditSeeds = [
      { action: 'TENANT_ONBOARDED', entity: 'Tenant', entityId: tenantA, summary: 'Sunrise Fuels onboarded on Growth plan', tenant: tenantA },
      { action: 'FUEL_PRICE_UPDATED', entity: 'FuelPrice', entityId: null, summary: 'Petrol price revised to ₹106.31/L', tenant: tenantA },
      { action: 'SHIFT_CLOSED', entity: 'Shift', entityId: null, summary: 'Shift #1 closed with aggregate totalizer capture', tenant: tenantA },
      { action: 'DEVICE_REGISTERED', entity: 'HardwareDevice', entityId: deviceIds[stationA.id], summary: 'Baner Gateway 01 registered', tenant: tenantA },
      { action: 'DELIVERY_RECEIVED', entity: 'Delivery', entityId: null, summary: 'Fuel delivery received at Hinjewadi outlet', tenant: tenantA },
      { action: 'CUSTOMER_PAYMENT_RECEIVED', entity: 'Payment', entityId: receiptId, summary: 'Customer receipt ₹6,000.00 via UPI', tenant: tenantA },
    ];
    auditSeeds.forEach((entry, index) => {
      run(
        `INSERT INTO audit_logs
          (id, tenant_id, station_id, actor_id, actor_email, actor_role, action, entity, entity_id, summary,
           ip, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1', 1, ?)`,
        [newId('aud'), entry.tenant, (index % 3 === 1 ? stationB : stationA).id, ownerA, 'owner@sunrisefuels.in', 'OWNER', entry.action,
          entry.entity, entry.entityId, entry.summary, isoAt(businessDate(index), 12)],
      );
    });
  });

  logger.info('Demo seed complete.');
  logger.info(
    { password: DEMO_PASSWORD, accounts: ['owner@sunrisefuels.in', 'manager@sunrisefuels.in'] },
    'Demo login credentials',
  );
  return { seeded: true, demoPassword: DEMO_PASSWORD };
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js');
if (isDirectRun) {
  (async () => {
    const { migrate } = await import('./index.js');
    migrate();
    await runSeed({ force: process.argv.includes('--force') });
    process.exit(0);
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

