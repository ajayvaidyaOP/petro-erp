import { Router } from 'express';
import { z } from 'zod';
import { ROLE_DEFINITIONS, ROLE_KEYS, permissionsForRole } from '@petroflow/shared';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, created, ok, parse } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { D, money, rate as fmtRate } from '../lib/decimal.js';
import { nowIso } from '../lib/time.js';
import { newId } from '../lib/ids.js';
import { hashPassword, assertPasswordStrength } from '../lib/security.js';
import { makeCrudRouter, isoDateTime } from '../lib/crud.js';
import { priceAt } from '../lib/pricing.js';
import { settingsValue } from '../lib/settings.js';
import { tankBookStock, convertDipToLitres } from '../lib/stock.js';

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
    color: z.string().max(20).default('#38bdf8'),
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
    return ok(res, shapeAll(rows));
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
    run(
      `INSERT INTO tank_measurements
        (id, tenant_id, station_id, tank_id, measured_at, dip_cm, measured_litres, book_stock_litres,
         variance_litres, method, entered_by, note, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, station.tenant_id, station.id, tank.id, body.measuredAt ?? nowIso(), body.dipCm ?? null,
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

const nozzleCrud = makeCrudRouter({
  table: 'nozzles',
  entity: 'Nozzle',
  idPrefix: 'noz',
  fields: ['stationId', 'dispenserId', 'productId', { name: 'number', type: 'integer' }, 'label', 'totalizerUnit', 'status'],
  stationScoped: true,
  searchColumns: ['label'],
  sortable: { label: 'label', number: 'number' },
  defaultSort: 'label ASC',
  permissions: { read: 'dispensers.read', write: 'dispensers.write' },
  createSchema: z.object({
    stationId: z.string().min(3),
    dispenserId: z.string().min(3),
    productId: z.string().min(3),
    number: z.coerce.number().int().min(1).max(99),
    label: z.string().min(1).max(40),
    totalizerUnit: z.string().max(6).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  }),
  updateSchema: z.object({
    label: z.string().min(1).max(40).optional(),
    number: z.coerce.number().int().min(1).max(99).optional(),
    productId: z.string().min(3).optional(),
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
    return data;
  },
  beforeUpdate: (data, _existing, auth) => {
    if (data.productId) {
      const product = get('SELECT id FROM fuel_products WHERE id = ? AND tenant_id = ?', [String(data.productId), tenantIdOf(auth)]);
      if (!product) throw notFound('Fuel product not found');
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

catalogRouter.get(
  '/roles',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'employees.read')) throw forbidden();
    return ok(
      res,
      ROLE_KEYS.filter((key) => key !== 'SUPER_ADMIN').map((key) => ({
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
      `SELECT u.id, u.name, u.email, u.phone, u.role_key, u.status, u.last_login_at, u.created_at, u.is_demo
         FROM users u WHERE u.tenant_id = ? AND u.role_key != 'SUPER_ADMIN' ORDER BY u.name`,
      [tenantId],
    );
    const employees = rows.map((row) => ({
      ...shape(row),
      stationIds: employeeStations(String(row.id)),
      permissions: permissionsForRole(String(row.role_key)),
    }));
    return ok(res, employees);
  }),
);

const employeeSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().max(200),
  phone: z.string().max(20).optional().nullable(),
  password: z.string().min(10).max(200),
  roleKey: z.enum(['OWNER', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'OPERATOR']),
  stationIds: z.array(z.string().min(3)).max(50).optional(),
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
    assertPasswordStrength(body.password);
    const email = body.email.toLowerCase().trim();
    if (get('SELECT id FROM users WHERE email = ?', [email])) throw conflict('A user with this email already exists');
    const stationIds = body.roleKey === 'OWNER' ? [] : body.stationIds ?? [];
    if (body.roleKey !== 'OWNER' && stationIds.length === 0) {
      throw unprocessable('Station staff must be assigned to at least one station');
    }
    for (const stationId of stationIds) getStationOrThrow(auth, stationId);
    const id = newId('usr');
    tx(() => {
      run(
        `INSERT INTO users (id, tenant_id, email, name, phone, password_hash, role_key, status, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, tenantId, email, body.name, body.phone ?? null, hashPassword(body.password), body.roleKey,
          body.status ?? 'ACTIVE', nowIso(), nowIso()],
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
      after: { name: body.name, email, roleKey: body.roleKey, stationIds },
    });
    return created(res, { id, name: body.name, email, roleKey: body.roleKey, stationIds });
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
        roleKey: z.enum(['OWNER', 'MANAGER', 'ACCOUNTANT', 'CASHIER', 'OPERATOR']).optional(),
        status: z.enum(['ACTIVE', 'DISABLED']).optional(),
        stationIds: z.array(z.string().min(3)).max(50).optional(),
      }),
      req.body,
    );
    const stationIds = body.stationIds ?? employeeStations(String(existing.id));
    for (const stationId of stationIds) getStationOrThrow(auth, stationId);
    tx(() => {
      const sets: string[] = [];
      const params: (string | null)[] = [];
      if (body.name !== undefined) { sets.push('name = ?'); params.push(body.name); }
      if (body.phone !== undefined) { sets.push('phone = ?'); params.push(body.phone ?? null); }
      if (body.roleKey !== undefined) { sets.push('role_key = ?'); params.push(body.roleKey); }
      if (body.status !== undefined) { sets.push('status = ?'); params.push(body.status); }
      if (sets.length) {
        run(`UPDATE users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, nowIso(), String(existing.id)]);
      }
      if (body.stationIds !== undefined) {
        run('DELETE FROM user_station_access WHERE user_id = ?', [String(existing.id)]);
        for (const stationId of body.stationIds) {
          run(
            'INSERT INTO user_station_access (id, user_id, station_id, permissions, created_at) VALUES (?, ?, ?, ?, ?)',
            [newId('usa'), String(existing.id), stationId, '[]', nowIso()],
          );
        }
      }
      if (body.status === 'DISABLED') {
        run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), String(existing.id)]);
      }
    });
    audit(req, {
      action: 'EMPLOYEE_UPDATED', entity: 'User', entityId: String(existing.id),
      before: { roleKey: existing.role_key, status: existing.status },
      after: { roleKey: body.roleKey ?? existing.role_key, status: body.status ?? existing.status, stationIds },
    });
    return ok(res, { id: existing.id, roleKey: body.roleKey ?? existing.role_key, stationIds });
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

export function maxJumpFor(tenantId: string, stationId: string) {
  return settingsValue('hardware.maxJumpLitres', tenantId, stationId, 10000);
}
