import { Router } from 'express';
import { z } from 'zod';
import { ROLE_DEFINITIONS, BUSINESS_ROLE_KEYS, permissionsForRole, sanitizeStaffGrants } from '../shared/index.js';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, created, ok, parse } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { D, money, rate as fmtRate } from '../lib/decimal.js';
import { nowIso , businessDateOf } from '../lib/time.js';
import { newId } from '../lib/ids.js';
import { hashPassword, assertPasswordStrength } from '../lib/security.js';
import { makeCrudRouter, isoDateTime } from '../lib/crud.js';
import { priceAt } from '../lib/pricing.js';
import { settingsValue } from '../lib/settings.js';
import { tankBookStock, convertDipToLitres } from '../lib/stock.js';
import { assertDayOpen } from '../lib/dayclose.js';

export const catalogRouter = Router();

catalogRouter.get(
  '/stations',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stations.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const rows = all<Record<string, unknown>>(
      `SELECT s.*,
              (SELECT COUNT(*) FROM tanks t WHERE t.station_id = s.id) AS tank_count,
              (SELECT COUNT(*) FROM dispensers d WHERE d.station_id = s.id) AS dispenser_count,
              (SELECT COUNT(*) FROM nozzles n WHERE n.station_id = s.id) AS nozzle_count,
              (SELECT COUNT(*) FROM hardware_devices h WHERE h.station_id = s.id) AS device_count
         FROM stations s WHERE s.tenant_id = ? ORDER BY s.name`,
      [tenantId],
    );
    const accessible = auth.allStations ? rows : rows.filter((r) => auth.stationIds.has(String(r.id)));
    return ok(res, shapeAll(accessible));
  }),
);

catalogRouter.post(
  '/stations',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stations.write')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const body = parse(
      z.object({
        code: z.string().min(1).max(20),
        name: z.string().min(2).max(120),
        address: z.string().max(300).optional().nullable(),
        city: z.string().max(80).optional().nullable(),
        state: z.string().max(80).optional().nullable(),
        pincode: z.string().max(10).optional().nullable(),
      }),
      req.body,
    );
    const limit = get<{ max_stations: number }>(
      `SELECT p.max_stations FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = ? AND s.status IN ('ACTIVE','TRIALING') ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId],
    );
    const count = get<{ count: number }>('SELECT COUNT(*) AS count FROM stations WHERE tenant_id = ?', [tenantId])?.count ?? 0;
    if (limit && count >= Number(limit.max_stations)) {
      throw unprocessable(`Your plan allows ${limit.max_stations} station(s). Upgrade to add more.`);
    }
    if (get('SELECT id FROM stations WHERE tenant_id = ? AND code = ?', [tenantId, body.code])) {
      throw conflict('A station with this code already exists');
    }
    const id = newId('stn');
    run(
      `INSERT INTO stations (id, tenant_id, code, name, address, city, state, pincode, timezone, status, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Kolkata', 'ACTIVE', 0, ?, ?)`,
      [id, tenantId, body.code, body.name, body.address ?? null, body.city ?? null, body.state ?? null,
        body.pincode ?? null, nowIso(), nowIso()],
    );
    // Grant the creator access when they are station-scoped.
    if (!auth.allStations) {
      run(
        'INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, ?, ?)',
        [newId('usa'), auth.user.id, id, '[]', nowIso()],
      );
    }
    audit(req, {
      action: 'STATION_CREATED', entity: 'Station', entityId: id, stationId: id,
      summary: `${body.name} (${body.code}) added to the organization`,
    });
    return created(res, shape(get('SELECT * FROM stations WHERE id = ?', [id])));
  }),
);

catalogRouter.patch(
  '/stations/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stations.write')) throw forbidden();
    const station = getStationOrThrow(auth, req.params.id);
    const body = parse(
      z.object({
        name: z.string().min(2).max(120).optional(),
        address: z.string().max(300).optional().nullable(),
        city: z.string().max(80).optional().nullable(),
        state: z.string().max(80).optional().nullable(),
        pincode: z.string().max(10).optional().nullable(),
        status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
      }),
      req.body,
    );
    const map: Record<string, string> = {
      name: 'name', address: 'address', city: 'city', state: 'state', pincode: 'pincode', status: 'status',
    };
    const entries = Object.entries(body).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      run(
        `UPDATE stations SET ${entries.map(([k]) => `${map[k]} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        [...entries.map(([, v]) => v as string), nowIso(), station.id],
      );
    }
    const row = get('SELECT * FROM stations WHERE id = ?', [station.id]);
    audit(req, {
      action: 'STATION_UPDATED', entity: 'Station', entityId: station.id, stationId: station.id,
      summary: `${station.name} configuration updated`, before: station, after: body,
    });
    return ok(res, shape(row));
  }),
);

// ----------------------------------------------------------------- products

const productRouter = makeCrudRouter({
  table: 'fuel_products',
  entity: 'FuelProduct',
  idPrefix: 'prd',
  fields: [
    'code', 'name', 'category', 'unit', 'color',
    { name: 'isActive', type: 'boolean' },
  ],
  tenantScoped: true,
  searchColumns: ['code', 'name'],
  sortable: { code: 'code', name: 'name' },
  defaultSort: 'code ASC',
  permissions: { read: 'products.read', write: 'products.write' },
  createSchema: z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(2).max(80),
    category: z.enum(['PETROL', 'DIESEL', 'CNG', 'LUBRICANT']).default('PETROL'),
    unit: z.string().max(6).default('L'),
    color: z.string().max(20).default('#ea580c'),
    isActive: z.boolean().optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(2).max(80).optional(),
    category: z.enum(['PETROL', 'DIESEL', 'CNG', 'LUBRICANT']).optional(),
    unit: z.string().max(6).optional(),
    color: z.string().max(20).optional(),
    isActive: z.boolean().optional(),
  }),
  hasUpdatedAt: true,
});
catalogRouter.use('/products', productRouter);

// ------------------------------------------------------------------- prices

catalogRouter.get(
  '/prices',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'products.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const productId = typeof req.query.productId === 'string' ? req.query.productId : null;
    const rows = all(
      `SELECT fp.*, p.name AS product_name, p.code AS product_code, s.name AS station_name
         FROM fuel_prices fp
         JOIN fuel_products p ON p.id = fp.product_id
         LEFT JOIN stations s ON s.id = fp.station_id
        WHERE fp.tenant_id = ? ${productId ? 'AND fp.product_id = ?' : ''}
        ORDER BY fp.effective_from DESC LIMIT 200`,
      productId ? [tenantId, productId] : [tenantId],
    );
    const requestedStation = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (requestedStation) getStationOrThrow(auth, requestedStation);
    const visible = rows.filter((row) => {
      const id = (row as Record<string, unknown>).station_id;
      return !id || ((auth.allStations || auth.stationIds.has(String(id))) && (!requestedStation || id === requestedStation));
    });
    return ok(res, shapeAll(visible));
  }),
);

catalogRouter.get(
  '/prices/current',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'products.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) getStationOrThrow(auth, stationId);
    const products = all<Record<string, unknown>>(
      'SELECT * FROM fuel_products WHERE tenant_id = ? AND is_active = 1 ORDER BY code',
      [tenantId],
    );
    const result = products.map((p) => {
      const price = priceAt(tenantId, String(p.id), stationId);
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        color: p.color,
        unit: p.unit,
        rate: price?.rate ?? null,
        effectiveFrom: price?.effectiveFrom ?? null,
        priceScope: price ? (price.stationId ? 'STATION' : 'TENANT') : null,
      };
    });
    return ok(res, result);
  }),
);

catalogRouter.post(
  '/prices',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'prices.write')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const body = parse(
      z.object({
        productId: z.string().min(3),
        stationId: z.string().min(3).optional().nullable(),
        rate: z.union([z.string(), z.number()]).transform(String),
        effectiveFrom: isoDateTime.optional(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    const product = get('SELECT * FROM fuel_products WHERE id = ? AND tenant_id = ?', [body.productId, tenantId]);
    if (!product) throw notFound('Fuel product not found');
    if (body.stationId) getStationOrThrow(auth, body.stationId);
    const rateNum = D(body.rate);
    if (rateNum.lte(0)) throw unprocessable('Rate must be greater than zero');
    const effectiveFrom = body.effectiveFrom ?? nowIso();
    const id = newId('fpr');
    tx(() => {
      run(
        `INSERT INTO fuel_prices
          (id, tenant_id, product_id, station_id, rate_per_litre, effective_from, note, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, body.productId, body.stationId ?? null, fmtRate(rateNum), effectiveFrom,
          body.note ?? null, auth.user.id, nowIso()],
      );
      // Close the previous open-ended period for the same scope.
      run(
        `UPDATE fuel_prices SET effective_to = ?
          WHERE tenant_id = ? AND product_id = ? AND station_id IS ?
            AND effective_to IS NULL AND effective_from < ? AND id != ?`,
        [effectiveFrom, tenantId, body.productId, body.stationId ?? null, effectiveFrom, id],
      );
    });
    const row = get('SELECT * FROM fuel_prices WHERE id = ?', [id]);
    audit(req, {
      action: 'FUEL_PRICE_CHANGED', entity: 'FuelPrice', entityId: id,
      stationId: body.stationId ?? null,
      summary: `${product.name} → ₹${fmtRate(rateNum)}/L effective ${effectiveFrom}`,
      after: shape(row),
    });
    return created(res, shape(row));
  }),
);

// -------------------------------------------------------------------- tanks

const tankCrud = makeCrudRouter({
  table: 'tanks',
  entity: 'Tank',
  idPrefix: 'tnk',
  fields: ['stationId', 'code', 'name', 'productId', 'capacityLitres', 'deadStockLitres', 'calibrationReference', 'status'],
  stationScoped: true,
  searchColumns: ['code', 'name'],
  sortable: { code: 'code', name: 'name', capacityLitres: 'capacity_litres' },
  defaultSort: 'code ASC',
  permissions: { read: 'tanks.read', write: 'tanks.write' },
  createSchema: z.object({
    stationId: z.string().min(3),
    code: z.string().min(1).max(20),
    name: z.string().min(2).max(80),
    productId: z.string().min(3),
    capacityLitres: z.union([z.string(), z.number()]).transform(String),
    deadStockLitres: z.union([z.string(), z.number()]).transform(String).optional(),
    calibrationReference: z.string().max(120).optional().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(2).max(80).optional(),
    capacityLitres: z.union([z.string(), z.number()]).transform(String).optional(),
    deadStockLitres: z.union([z.string(), z.number()]).transform(String).optional(),
    calibrationReference: z.string().max(120).optional().nullable(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  hasUpdatedAt: true,
  beforeCreate: (data, auth) => {
    const tenantId = tenantIdOf(auth);
    const product = get('SELECT id FROM fuel_products WHERE id = ? AND tenant_id = ?', [String(data.productId), tenantId]);
    if (!product) throw notFound('Fuel product not found');
    if (D(String(data.capacityLitres)).lte(0)) throw unprocessable('Capacity must be greater than zero');
    return data;
  },
});
catalogRouter.use('/tanks', tankCrud);

catalogRouter.get(
  '/tanks/:id/calibration',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'tanks.read')) throw forbidden();
    const tank = get<Record<string, unknown>>('SELECT * FROM tanks WHERE id = ?', [req.params.id]);
    if (!tank) throw notFound('Tank not found');
    getStationOrThrow(auth, String(tank.station_id));
    const points = all(
      'SELECT * FROM tank_calibration_points WHERE tank_id = ? ORDER BY CAST(dip_cm AS REAL) ASC',
      [tank.id],
    );
    return ok(res, {
      tank: shape(tank),
      points: shapeAll(points),
    });
  }),
);

catalogRouter.put(
  '/tanks/:id/calibration',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'tanks.write')) throw forbidden();
    const tank = get<Record<string, unknown>>('SELECT * FROM tanks WHERE id = ?', [req.params.id]);
    if (!tank) throw notFound('Tank not found');
    getStationOrThrow(auth, String(tank.station_id));
    const body = parse(
      z.object({
        reference: z.string().max(120).optional().nullable(),
        points: z
          .array(
            z.object({
              dipCm: z.union([z.string(), z.number()]).transform(String),
              litres: z.union([z.string(), z.number()]).transform(String),
            }),
          )
          .max(200),
      }),
      req.body,
    );
    tx(() => {
      run('DELETE FROM tank_calibration_points WHERE tank_id = ?', [tank.id]);
      for (const point of body.points) {
        run(
          'INSERT INTO tank_calibration_points (id, tank_id, dip_cm, litres) VALUES (?, ?, ?, ?)',
          [newId('cal'), tank.id, point.dipCm, point.litres],
        );
      }
      run('UPDATE tanks SET calibration_reference = ?, updated_at = ? WHERE id = ?', [
        body.reference ?? tank.calibration_reference ?? null, nowIso(), tank.id,
      ]);
    });
    audit(req, {
      action: 'TANK_CALIBRATION_UPDATED', entity: 'Tank', entityId: String(tank.id),
      stationId: String(tank.station_id), summary: `${body.points.length} calibration points stored`,
    });
    return ok(res, { tankId: tank.id, points: body.points.length });
  }),
);

catalogRouter.get(
  '/tanks/:id/measurements',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'tanks.read')) throw forbidden();
    const tank = get<Record<string, unknown>>('SELECT * FROM tanks WHERE id = ?', [req.params.id]);
    if (!tank) throw notFound('Tank not found');
    getStationOrThrow(auth, String(tank.station_id));
    const rows = all(
      'SELECT * FROM tank_measurements WHERE tank_id = ? ORDER BY measured_at DESC LIMIT 100',
      [tank.id],
    );
    return ok(res, shapeAll(rows));
  }),
);

catalogRouter.post(
  '/tanks/:id/measurements',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.write')) throw forbidden();
    const tank = get<Record<string, unknown>>('SELECT * FROM tanks WHERE id = ?', [req.params.id]);
    if (!tank) throw notFound('Tank not found');
    const station = getStationOrThrow(auth, String(tank.station_id));
    const body = parse(
      z.object({
        measuredAt: isoDateTime.optional(),
        dipCm: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
        waterDipCm: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
        measuredLitres: z.union([z.string(), z.number()]).transform(String).optional(),
        note: z.string().max(300).optional().nullable(),
        method: z.enum(['DIP', 'MANUAL', 'AUTOMATED']).optional(),
      }),
      req.body,
    );
    if (!body.dipCm && !body.measuredLitres) throw unprocessable('Provide a dip reading or measured litres');
    const book = tankBookStock(String(tank.id));
    const litres = body.measuredLitres
      ? D(body.measuredLitres)
      : convertDipToLitres(String(tank.id), body.dipCm!);
    if (litres.lt(0)) throw unprocessable('Measured litres cannot be negative');
    const variance = litres.minus(book);
    const id = newId('tms');
    assertDayOpen(station.id, businessDateOf(body.measuredAt ?? nowIso()));
    run(
      `INSERT INTO tank_measurements
        (id, tenant_id, station_id, tank_id, measured_at, dip_cm, water_dip_cm, measured_litres, book_stock_litres,
         variance_litres, method, entered_by, note, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, station.tenant_id, station.id, tank.id, body.measuredAt ?? nowIso(), body.dipCm ?? null, body.waterDipCm ?? null,
        litres.toFixed(3), book.toFixed(3), variance.toFixed(3), body.method ?? (body.dipCm ? 'DIP' : 'MANUAL'),
        auth.user.id, body.note ?? null, nowIso()],
    );
    audit(req, {
      action: 'TANK_MEASUREMENT_RECORDED', entity: 'TankMeasurement', entityId: id, stationId: station.id,
      summary: `${tank.code}: measured ${litres.toFixed(3)} L vs book ${book.toFixed(3)} L (variance ${variance.toFixed(3)} L)`,
      after: { measuredLitres: litres.toFixed(3), bookLitres: book.toFixed(3), varianceLitres: variance.toFixed(3) },
    });
    return created(res, shape(get('SELECT * FROM tank_measurements WHERE id = ?', [id])));
  }),
);

// --------------------------------------------------------------- dispensers

const dispenserCrud = makeCrudRouter({
  table: 'dispensers',
  entity: 'Dispenser',
  idPrefix: 'dsp',
  fields: ['stationId', 'code', 'name', 'model', 'serialNumber', 'protocol', 'status'],
  stationScoped: true,
  searchColumns: ['code', 'name', 'serial_number'],
  sortable: { code: 'code', name: 'name' },
  defaultSort: 'code ASC',
  permissions: { read: 'dispensers.read', write: 'dispensers.write' },
  createSchema: z.object({
    stationId: z.string().min(3),
    code: z.string().min(1).max(20),
    name: z.string().min(2).max(80),
    model: z.string().max(80).optional().nullable(),
    serialNumber: z.string().min(1).max(80),
    protocol: z.string().max(80).optional().nullable(),
    status: z.enum(['ACTIVE', 'OFFLINE', 'MAINTENANCE']).optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(2).max(80).optional(),
    model: z.string().max(80).optional().nullable(),
    serialNumber: z.string().min(1).max(80).optional(),
    protocol: z.string().max(80).optional().nullable(),
    status: z.enum(['ACTIVE', 'OFFLINE', 'MAINTENANCE']).optional(),
  }),
  hasUpdatedAt: true,
});
catalogRouter.use('/dispensers', dispenserCrud);

// ------------------------------------------------------------------ nozzles

/** Nozzle jis tank se juda hai, us tank ka product nozzle ke product se milna hi chahiye. */
function validateNozzleTank(tankId: string | null | undefined, stationId: string, productId: string) {
  if (!tankId) return;
  const tank = get<{ station_id: string; product_id: string }>('SELECT station_id, product_id FROM tanks WHERE id = ?', [tankId]);
  if (!tank) throw notFound('Tank not found');
  if (tank.station_id !== stationId) throw unprocessable('Nozzle ka tank usi station par hona chahiye');
  if (tank.product_id !== productId) throw unprocessable('Tank ka product nozzle ke product se match nahi karta — galat tank jud jayega');
}

const nozzleCrud = makeCrudRouter({
  table: 'nozzles',
  entity: 'Nozzle',
  idPrefix: 'noz',
  fields: ['stationId', 'dispenserId', 'productId', 'tankId', { name: 'number', type: 'integer' }, 'label', 'totalizerUnit', 'status'],
  stationScoped: true,
  searchColumns: ['label'],
  sortable: { label: 'label', number: 'number' },
  defaultSort: 'label ASC',
  permissions: { read: 'dispensers.read', write: 'dispensers.write' },
  createSchema: z.object({
    stationId: z.string().min(3),
    dispenserId: z.string().min(3),
    productId: z.string().min(3),
    tankId: z.string().min(3).optional().nullable(),
    number: z.coerce.number().int().min(1).max(99),
    label: z.string().min(1).max(40),
    totalizerUnit: z.string().max(6).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  updateSchema: z.object({
    label: z.string().min(1).max(40).optional(),
    number: z.coerce.number().int().min(1).max(99).optional(),
    productId: z.string().min(3).optional(),
    tankId: z.string().min(3).optional().nullable(),
    totalizerUnit: z.string().max(6).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  hasUpdatedAt: true,
  beforeCreate: (data, auth) => {
    const tenantId = tenantIdOf(auth);
    const dispenser = get<Record<string, unknown>>('SELECT * FROM dispensers WHERE id = ?', [String(data.dispenserId)]);
    if (!dispenser) throw notFound('Dispenser not found');
    if (dispenser.station_id !== data.stationId) throw unprocessable('Nozzle must belong to the dispenser’s station');
    const product = get('SELECT id FROM fuel_products WHERE id = ? AND tenant_id = ?', [String(data.productId), tenantId]);
    if (!product) throw notFound('Fuel product not found');
    validateNozzleTank(data.tankId as string | null | undefined, String(data.stationId), String(data.productId));
    return data;
  },
  beforeUpdate: (data, existing, auth) => {
    const productId = String(data.productId ?? existing.product_id);
    if (data.productId) {
      const product = get('SELECT id FROM fuel_products WHERE id = ? AND tenant_id = ?', [String(data.productId), tenantIdOf(auth)]);
      if (!product) throw notFound('Fuel product not found');
    }
    if (data.tankId !== undefined) {
      validateNozzleTank(data.tankId as string | null, String(existing.station_id), productId);
    }
    return data;
  },
});
catalogRouter.use('/nozzles', nozzleCrud);

catalogRouter.get(
  '/nozzles/:id/history',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'readings.read')) throw forbidden();
    const nozzle = get<Record<string, unknown>>('SELECT * FROM nozzles WHERE id = ?', [req.params.id]);
    if (!nozzle) throw notFound('Nozzle not found');
    getStationOrThrow(auth, String(nozzle.station_id));
    const rows = all(
      'SELECT * FROM meter_readings WHERE nozzle_id = ? ORDER BY reading_at DESC LIMIT 50',
      [nozzle.id],
    );
    return ok(res, shapeAll(rows));
  }),
);

// --------------------------------------------------- customers & suppliers

const customerCrud = makeCrudRouter({
  table: 'customers',
  entity: 'Customer',
  idPrefix: 'cus',
  fields: [
    'code', 'name', 'phone', 'email', 'gstin', 'address',
    { name: 'creditLimit', type: 'decimal' },
    { name: 'creditDays', type: 'integer' },
    'status',
  ],
  tenantScoped: true,
  searchColumns: ['code', 'name', 'phone'],
  sortable: { code: 'code', name: 'name', creditLimit: 'CAST(credit_limit AS REAL)' },
  defaultSort: 'name ASC',
  permissions: { read: 'customers.read', write: 'customers.write' },
  createSchema: z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(2).max(100),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().max(120).optional().nullable().or(z.literal('')),
    gstin: z.string().max(20).optional().nullable(),
    address: z.string().max(300).optional().nullable(),
    creditLimit: z.union([z.string(), z.number()]).transform(String).optional(),
    creditDays: z.coerce.number().int().min(0).max(365).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().max(120).optional().nullable().or(z.literal('')),
    gstin: z.string().max(20).optional().nullable(),
    address: z.string().max(300).optional().nullable(),
    creditLimit: z.union([z.string(), z.number()]).transform(String).optional(),
    creditDays: z.coerce.number().int().min(0).max(365).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  hasUpdatedAt: true,
});
catalogRouter.use('/customers', customerCrud);

// ------------------------------------------------------ customer vehicles
// Credit customer ki gaadiyan — slip par gaadi number + driver ke liye.

function customerInTenantOrThrow(auth: AuthContext, customerId: string) {
  const customer = get<Record<string, unknown>>('SELECT * FROM customers WHERE id = ? AND tenant_id = ?', [
    customerId, tenantIdOf(auth),
  ]);
  if (!customer) throw notFound('Customer not found');
  return customer;
}

catalogRouter.get(
  '/customers/:id/vehicles',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.read')) throw forbidden();
    const customer = customerInTenantOrThrow(auth, req.params.id);
    const rows = all('SELECT * FROM customer_vehicles WHERE customer_id = ? ORDER BY vehicle_number', [String(customer.id)]);
    return ok(res, shapeAll(rows));
  }),
);

catalogRouter.post(
  '/customers/:id/vehicles',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.write')) throw forbidden();
    const customer = customerInTenantOrThrow(auth, req.params.id);
    const body = parse(
      z.object({
        vehicleNumber: z.string().trim().toUpperCase().pipe(z.string().min(4).max(20).regex(/^[A-Z0-9][A-Z0-9 -]*$/, 'Gaadi number sahi format me daalo (e.g. MH12AB1234)')),
        vehicleType: z.string().max(40).optional().nullable(),
        driverName: z.string().max(80).optional().nullable(),
      }),
      req.body,
    );
    const id = newId('veh');
    try {
      run(
        `INSERT INTO customer_vehicles (id, tenant_id, customer_id, vehicle_number, vehicle_type, driver_name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, tenantIdOf(auth), String(customer.id), body.vehicleNumber.replace(/\s+/g, ''), body.vehicleType ?? null, body.driverName ?? null, nowIso(), nowIso()],
      );
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) throw conflict('Ye gaadi is customer ke liye pehle se register hai');
      throw error;
    }
    audit(req, {
      action: 'CUSTOMER_VEHICLE_ADDED', entity: 'CustomerVehicle', entityId: id,
      summary: `${String(customer.name)}: gaadi ${body.vehicleNumber} jodi gayi`,
    });
    return created(res, shape(get('SELECT * FROM customer_vehicles WHERE id = ?', [id])));
  }),
);

catalogRouter.delete(
  '/customers/:id/vehicles/:vehicleId',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.write')) throw forbidden();
    const customer = customerInTenantOrThrow(auth, req.params.id);
    const vehicle = get<Record<string, unknown>>('SELECT * FROM customer_vehicles WHERE id = ? AND customer_id = ?', [
      req.params.vehicleId, String(customer.id),
    ]);
    if (!vehicle) throw notFound('Vehicle not found');
    run('UPDATE customer_vehicles SET is_active = 0, updated_at = ? WHERE id = ?', [nowIso(), String(vehicle.id)]);
    audit(req, {
      action: 'CUSTOMER_VEHICLE_DEACTIVATED', entity: 'CustomerVehicle', entityId: String(vehicle.id),
      summary: `${String(customer.name)}: gaadi ${String(vehicle.vehicle_number)} bandh ki gayi`,
    });
    return ok(res, { deactivated: true });
  }),
);

const supplierCrud = makeCrudRouter({
  table: 'suppliers',
  entity: 'Supplier',
  idPrefix: 'sup',
  fields: [
    'code', 'name', 'gstin', 'contactPerson', 'phone', 'email', 'address',
    { name: 'creditDays', type: 'integer' },
    { name: 'openingBalance', type: 'decimal' },
    { name: 'isActive', type: 'boolean' },
  ],
  tenantScoped: true,
  searchColumns: ['code', 'name', 'gstin'],
  sortable: { code: 'code', name: 'name' },
  defaultSort: 'name ASC',
  permissions: { read: 'suppliers.read', write: 'suppliers.write' },
  createSchema: z.object({
    code: z.string().min(1).max(20),
    name: z.string().min(2).max(120),
    gstin: z.string().max(20).optional().nullable(),
    contactPerson: z.string().max(80).optional().nullable(),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().max(120).optional().nullable().or(z.literal('')),
    address: z.string().max(300).optional().nullable(),
    creditDays: z.coerce.number().int().min(0).max(365).optional(),
    openingBalance: z.union([z.string(), z.number()]).transform(String).optional(),
    isActive: z.boolean().optional(),
  }),
  updateSchema: z.object({
    name: z.string().min(2).max(120).optional(),
    gstin: z.string().max(20).optional().nullable(),
    contactPerson: z.string().max(80).optional().nullable(),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().max(120).optional().nullable().or(z.literal('')),
    address: z.string().max(300).optional().nullable(),
    creditDays: z.coerce.number().int().min(0).max(365).optional(),
    openingBalance: z.union([z.string(), z.number()]).transform(String).optional(),
    isActive: z.boolean().optional(),
  }),
  hasUpdatedAt: true,
});
catalogRouter.use('/suppliers', supplierCrud);

const expenseCategoryCrud = makeCrudRouter({
  table: 'expense_categories',
  entity: 'ExpenseCategory',
  idPrefix: 'exc',
  fields: ['name', { name: 'isActive', type: 'boolean' }],
  tenantScoped: true,
  searchColumns: ['name'],
  sortable: { name: 'name' },
  defaultSort: 'name ASC',
  permissions: { read: 'expenses.read', write: 'expenses.write' },
  createSchema: z.object({ name: z.string().min(2).max(60), isActive: z.boolean().optional() }),
  updateSchema: z.object({ name: z.string().min(2).max(60).optional(), isActive: z.boolean().optional() }),
});
catalogRouter.use('/expense-categories', expenseCategoryCrud);

// ---------------------------------------------------------------- employees

function employeeStations(userId: string) {
  return all<{ station_id: string }>('SELECT station_id FROM user_station_access WHERE user_id = ?', [userId]).map(
    (r) => r.station_id,
  );
}

function employeePermissions(row: Record<string, unknown>): string[] {
  if (String(row.role_key) === 'STAFF') return sanitizeStaffGrants(safeJson(row.granted_permissions));
  return permissionsForRole(String(row.role_key));
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string' || value.length === 0) return [];
  try { return JSON.parse(value); } catch { return []; }
}

function assertSeatAvailable(tenantId: string, roleKey: string) {
  if (roleKey === 'OWNER') throw conflict('This organization already has one owner. The owner account cannot be duplicated.');
  if (roleKey === 'MANAGER' && get(`SELECT id FROM users WHERE tenant_id = ? AND role_key = 'MANAGER' AND status = 'ACTIVE'`, [tenantId])) {
    throw conflict('Only one manager is allowed. Add a staff login if you need another person with chosen permissions.');
  }
}

function assertUserCap(tenantId: string) {
  const cap = get<{ max_users: number }>(
    `SELECT p.max_users FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
      WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
    [tenantId],
  )?.max_users ?? 15;
  const active = get<{ count: number }>(
    `SELECT COUNT(*) AS count FROM users WHERE tenant_id = ? AND status = 'ACTIVE'`,
    [tenantId],
  )?.count ?? 0;
  if (active >= cap) {
    throw conflict(`This plan allows ${cap} team logins. Disable an unused account or ask the platform administrator to raise the limit.`);
  }
}

catalogRouter.get(
  '/roles',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.read')) throw forbidden();
    return ok(
      res,
      BUSINESS_ROLE_KEYS.map((key) => ({
        key,
        ...ROLE_DEFINITIONS[key],
      })),
    );
  }),
);

catalogRouter.get(
  '/employees',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const rows = all<Record<string, unknown>>(
      `SELECT u.id, u.name, u.email, u.phone, u.role_key, u.status, u.last_login_at, u.created_at, u.is_demo, u.granted_permissions
         FROM users u WHERE u.tenant_id = ? AND u.role_key IN ('OWNER', 'MANAGER', 'STAFF')
           AND (? = 1 OR (u.role_key != 'OWNER' AND EXISTS (SELECT 1 FROM user_station_access usa WHERE usa.user_id = u.id AND usa.station_id IN (SELECT station_id FROM user_station_access WHERE user_id = ?)))) ORDER BY u.name`,
      [tenantId, auth.allStations ? 1 : 0, auth.user.id],
    );
    const employees = rows.map<Record<string, unknown>>((row) => ({
      ...shape(row),
      stationIds: employeeStations(String(row.id)).filter((id) => auth.allStations || auth.stationIds.has(id)),
      permissions: employeePermissions(row),
    }));
    const visible = employees.filter((employee) => {
      if (employee.roleKey === 'STAFF') return true;
      if (employee.status === 'ACTIVE') return true;
      if (employee.roleKey === 'MANAGER' && !employees.some((row) => row.roleKey === 'MANAGER' && row.status === 'ACTIVE')) return true;
      return false;
    });
    return ok(res, visible);
  }),
);

const employeeSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(20).optional().nullable(),
  password: z.string().min(10).max(200),
  roleKey: z.enum(['OWNER', 'MANAGER', 'STAFF']),
  stationIds: z.array(z.string().min(3)).max(50).optional(),
  permissions: z.array(z.string().min(3).max(40)).max(80).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
});

catalogRouter.post(
  '/employees',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.write')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const body = parse(employeeSchema, req.body);
    assertSeatAvailable(tenantId, body.roleKey);
    assertUserCap(tenantId);
    assertPasswordStrength(body.password);
    const email = body.email.toLowerCase().trim();
    if (get('SELECT id FROM users WHERE email = ?', [email])) throw conflict('A user with this email already exists');
    const stationIds = body.stationIds ?? [];
    if (stationIds.length === 0) throw unprocessable('Assign this login to at least one pump');
    for (const stationId of stationIds) getStationOrThrow(auth, stationId);
    const grants = body.roleKey === 'STAFF' ? sanitizeStaffGrants(body.permissions ?? []) : [];
    if (body.roleKey === 'STAFF' && grants.length === 0) {
      throw unprocessable('Tick at least one permission. A staff login with no access cannot sign in to any screen.');
    }
    const id = newId('usr');
    tx(() => {
      run(
        `INSERT INTO users (id, tenant_id, email, name, phone, password_hash, role_key, status, is_demo, granted_permissions, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, tenantId, email, body.name, body.phone ?? null, hashPassword(body.password), body.roleKey,
          body.status ?? 'ACTIVE', JSON.stringify(grants), nowIso(), nowIso()],
      );
      for (const stationId of stationIds) {
        run(
          'INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, ?, ?)',
          [newId('usa'), id, stationId, '[]', nowIso()],
        );
      }
    });
    audit(req, {
      action: 'EMPLOYEE_CREATED', entity: 'User', entityId: id,
      summary: `${body.name} (${body.roleKey})`,
      after: { name: body.name, email, roleKey: body.roleKey, stationIds, permissions: grants },
    });
    return created(res, { id, name: body.name, email, roleKey: body.roleKey, stationIds, permissions: grants });
  }),
);

catalogRouter.patch(
  '/employees/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.write')) throw forbidden();
    const existing = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!existing) throw notFound('Employee not found');
    if (existing.role_key === 'SUPER_ADMIN') throw forbidden('Platform administrators cannot be modified here');
    const body = parse(
      z.object({
        name: z.string().min(2).max(120).optional(),
        phone: z.string().max(20).optional().nullable(),
        roleKey: z.enum(['OWNER', 'MANAGER', 'STAFF']).optional(),
        status: z.enum(['ACTIVE', 'DISABLED']).optional(),
        stationIds: z.array(z.string().min(3)).max(50).optional(),
        permissions: z.array(z.string().min(3).max(40)).max(80).optional(),
      }),
      req.body,
    );
    if (existing.role_key === 'OWNER' && (body.status === 'DISABLED' || (body.roleKey && body.roleKey !== 'OWNER'))) {
      throw unprocessable('The owner account must remain active. You can update its name and phone.');
    }
    if (body.roleKey && body.roleKey !== existing.role_key) {
      throw unprocessable('The owner and manager seats are fixed. Create a staff login for a custom permission set.');
    }
    if (existing.role_key === 'MANAGER' && body.status === 'ACTIVE' && get(
      `SELECT id FROM users WHERE tenant_id = ? AND role_key = 'MANAGER' AND status = 'ACTIVE' AND id != ?`, [tenantIdOf(auth), String(existing.id)],
    )) throw conflict('An active manager already exists.');
    if (body.status === 'ACTIVE' && existing.status !== 'ACTIVE') assertUserCap(tenantIdOf(auth));
    const stationIds = existing.role_key === 'OWNER' ? [] : body.stationIds ?? employeeStations(String(existing.id));
    if (existing.role_key !== 'OWNER' && stationIds.length === 0) throw unprocessable('Assign this login to at least one pump.');
    for (const stationId of stationIds) getStationOrThrow(auth, stationId);
    const grants = existing.role_key === 'STAFF'
      ? sanitizeStaffGrants(body.permissions ?? safeJson(existing.granted_permissions))
      : [];
    if (existing.role_key === 'STAFF' && grants.length === 0) {
      throw unprocessable('A staff login needs at least one permission.');
    }
    tx(() => {
      const sets: string[] = [];
      const params: (string | null)[] = [];
      if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
      if (body.phone !== undefined) { sets.push('phone = ?'); params.push(body.phone ?? null); }
      if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status); }
      if (existing.role_key === 'STAFF' && body.permissions !== undefined) {
        sets.push('granted_permissions = ?');
        params.push(JSON.stringify(grants));
      }
      if (sets.length) {
        run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, nowIso(), String(existing.id)]);
      }
      if (body.stationIds !== undefined && existing.role_key !== 'OWNER') {
        run('DELETE FROM user_station_access WHERE user_id = ?', [String(existing.id)]);
        for (const stationId of body.stationIds) {
          run(
            'INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, ?, ?)',
            [newId('usa'), String(existing.id), stationId, '[]', nowIso()],
          );
        }
      }
      if (body.status === 'DISABLED' || (existing.role_key === 'STAFF' && body.permissions !== undefined)) {
        run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), String(existing.id)]);
      }
    });
    audit(req, {
      action: 'EMPLOYEE_UPDATED', entity: 'User', entityId: String(existing.id),
      before: { roleKey: existing.role_key, status: existing.status },
      after: { roleKey: existing.role_key, status: body.status ?? existing.status, stationIds, permissions: grants },
    });
    return ok(res, { id: existing.id, roleKey: existing.role_key, stationIds, permissions: existing.role_key === 'STAFF' ? grants : permissionsForRole(String(existing.role_key)) });
  }),
);

catalogRouter.post(
  '/employees/:id/reset-password',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.write')) throw forbidden();
    const existing = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!existing) throw notFound('Employee not found');
    const body = parse(z.object({ newPassword: z.string().min(10).max(200) }), req.body);
    assertPasswordStrength(body.newPassword);
    tx(() => {
      run('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?', [
        hashPassword(body.newPassword), nowIso(), String(existing.id),
      ]);
      run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), String(existing.id)]);
    });
    audit(req, {
      action: 'EMPLOYEE_PASSWORD_RESET', entity: 'User', entityId: String(existing.id),
      summary: `Password reset for ${existing.email}; all sessions revoked`,
    });
    return ok(res, { reset: true });
  }),
);

catalogRouter.delete(
  '/employees/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.write')) throw forbidden();
    const existing = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!existing) throw notFound('Employee not found');
    if (existing.id === auth.user.id) throw unprocessable('You cannot disable your own account');
    if (existing.role_key === 'OWNER') throw unprocessable('The owner account cannot be disabled.');
    tx(() => {
      run('UPDATE users SET status = ?, updated_at = ? WHERE id = ?', ['DISABLED', nowIso(), String(existing.id)]);
      run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), String(existing.id)]);
    });
    audit(req, {
      action: 'EMPLOYEE_DISABLED', entity: 'User', entityId: String(existing.id),
      summary: `${existing.name} disabled`,
    });
    return ok(res, { disabled: true });
  }),
);

const followupSchema = z.object({
  kind: z.enum(['CALL', 'VISIT', 'PROMISE', 'NOTE']),
  note: z.string().min(2).max(500),
  promisedAmount: z.string().max(20).optional().nullable(),
  nextOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  stationId: z.string().min(3).optional().nullable(),
});

catalogRouter.get(
  '/followups',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.read')) throw forbidden();
    const today = typeof req.query.dueBy === 'string' ? req.query.dueBy : new Date().toISOString().slice(0, 10);
    const rows = all(
      `SELECT f.*, c.name AS customer_name, c.code AS customer_code, c.balance
         FROM customer_followups f
         JOIN customers c ON c.id = f.customer_id
        WHERE f.tenant_id = ? AND f.next_on IS NOT NULL AND f.next_on <= ?
        ORDER BY f.next_on ASC, f.created_at DESC
        LIMIT 30`,
      [tenantIdOf(auth), today],
    );
    return ok(res, shapeAll(rows));
  }),
);

catalogRouter.get(
  '/customers/:id/followups',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.read')) throw forbidden();
    const customer = get('SELECT id FROM customers WHERE id = ? AND tenant_id = ?', [req.params.id, tenantIdOf(auth)]);
    if (!customer) throw notFound('Customer not found');
    const rows = all(
      `SELECT f.*, u.name AS created_by_name
         FROM customer_followups f
         LEFT JOIN users u ON u.id = f.created_by
        WHERE f.customer_id = ? AND f.tenant_id = ?
        ORDER BY f.created_at DESC
        LIMIT 40`,
      [req.params.id, tenantIdOf(auth)],
    );
    return ok(res, shapeAll(rows));
  }),
);

catalogRouter.post(
  '/customers/:id/followups',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.write')) throw forbidden();
    const customer = get('SELECT id, name FROM customers WHERE id = ? AND tenant_id = ?', [req.params.id, tenantIdOf(auth)]);
    if (!customer) throw notFound('Customer not found');
    const body = parse(followupSchema, req.body);
    if (body.stationId) getStationOrThrow(auth, body.stationId);
    const id = newId('cfu');
    run(
      `INSERT INTO customer_followups (id, tenant_id, customer_id, station_id, kind, note, promised_amount, next_on, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, tenantIdOf(auth), req.params.id, body.stationId ?? null, body.kind, body.note.trim(),
        body.promisedAmount ?? null, body.nextOn ?? null, auth.user.id, nowIso()],
    );
    audit(req, {
      action: 'CUSTOMER_FOLLOWUP', entity: 'Customer', entityId: String(req.params.id),
      summary: `${body.kind} · ${(customer as { name: string }).name}`,
      after: { note: body.note, nextOn: body.nextOn ?? null },
    });
    return created(res, { id });
  }),
);

export function maxJumpFor(tenantId: string, stationId: string) {
  return settingsValue('hardware.maxJumpLitres', tenantId, stationId, 10000);
}
