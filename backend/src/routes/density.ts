import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll } from '../db/index.js';
import { asyncHandler, created, ok, parse, pageMeta, paging } from '../lib/http.js';
import { forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso, businessDateOf, isIsoDate } from '../lib/time.js';
import { D } from '../lib/decimal.js';
import { evaluateDensity } from '../lib/density.js';
import { assertDayOpen } from '../lib/dayclose.js';

export const densityRouter = Router();
densityRouter.use(requireAuth);

const decimalInput = z.union([z.string(), z.number()]).transform(String);

// -------------------------------------------------------------------- list
densityRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'density.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['d.station_id = ?'];
    const params: (string | number)[] = [station.id];
    if (typeof req.query.from === 'string' && req.query.from) { clauses.push('d.business_date >= ?'); params.push(req.query.from); }
    if (typeof req.query.to === 'string' && req.query.to) { clauses.push('d.business_date <= ?'); params.push(req.query.to); }
    if (typeof req.query.tankId === 'string' && req.query.tankId) { clauses.push('d.tank_id = ?'); params.push(req.query.tankId); }
    const where = clauses.join(' AND ');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM density_checks d WHERE ${where}`, params)?.count ?? 0;
    const rows = all(
      `SELECT d.*, t.code AS tank_code, t.name AS tank_name, p.name AS product_name, p.code AS product_code,
              p.category AS product_category, p.color AS product_color, u.name AS checked_by_name
         FROM density_checks d
         JOIN tanks t ON t.id = d.tank_id
         JOIN fuel_products p ON p.id = d.product_id
         LEFT JOIN users u ON u.id = d.checked_by
        WHERE ${where}
        ORDER BY d.business_date DESC, d.checked_at DESC
        LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

// ------------------------------------------------------------------ create
densityRouter.post(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'density.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        tankId: z.string().min(3),
        businessDate: z.string().refine(isIsoDate, 'Enter a valid YYYY-MM-DD date').optional(),
        checkedAt: z.string().datetime().optional(),
        observedDensity: decimalInput,
        observedTempC: decimalInput,
        source: z.enum(['NOZZLE', 'TANK', 'TT_SAMPLE']).optional(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const tank = get<{ id: string; station_id: string; product_id: string; code: string }>(
      'SELECT id, station_id, product_id, code FROM tanks WHERE id = ?',
      [body.tankId],
    );
    if (!tank || tank.station_id !== station.id) throw notFound('Tank not found for this station');
    const product = get<{ category: string; name: string }>('SELECT category, name FROM fuel_products WHERE id = ?', [tank.product_id]);
    const observed = D(body.observedDensity);
    const temp = D(body.observedTempC);
    if (observed.lt(600) || observed.gt(1000)) {
      throw unprocessable('Observed density kg/m³ me honi chahiye (e.g. petrol 742.5, diesel 834.0) — 0.742 jaisi value nahi');
    }
    if (temp.lt(-10) || temp.gt(60)) throw unprocessable('Temperature °C me daalo (aam taur par 20–40 ke beech)');
    const businessDate = body.businessDate ?? businessDateOf(body.checkedAt ?? nowIso());
    assertDayOpen(station.id, businessDate);
    const evaluation = evaluateDensity(product?.category ?? 'PETROL', body.observedDensity, body.observedTempC);
    const id = newId('den');
    run(
      `INSERT INTO density_checks
        (id, tenant_id, station_id, tank_id, product_id, business_date, checked_at, observed_density,
         observed_temp_c, density_at_15c, spec_min, spec_max, within_spec, source, checked_by, note, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [id, tenantIdOf(auth), station.id, tank.id, tank.product_id, businessDate, body.checkedAt ?? nowIso(),
        observed.toFixed(2), temp.toFixed(1), evaluation.densityAt15c, evaluation.specMin, evaluation.specMax,
        evaluation.withinSpec ? 1 : 0, body.source ?? 'NOZZLE', auth.user.id, body.note ?? null, nowIso()],
    );
    audit(req, {
      action: 'DENSITY_CHECK_RECORDED', entity: 'DensityCheck', entityId: id, stationId: station.id,
      summary: `${tank.code} (${product?.name ?? ''}): density ${evaluation.densityAt15c} kg/m³ @15°C ${evaluation.withinSpec ? '(spec me hai)' : '(SPEC SE BAHAR!)'}`,
      after: { observed: observed.toFixed(2), tempC: temp.toFixed(1), at15c: evaluation.densityAt15c, withinSpec: evaluation.withinSpec },
    });
    return created(res, shape(get('SELECT * FROM density_checks WHERE id = ?', [id])));
  }),
);

// ------------------------------------------------------------------ delete
// Register ki entry mitana sirf manager (dayclose) kar sakta hai aur audit rehta hai.
densityRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'dayclose.manage')) throw forbidden();
    const row = get<Record<string, unknown>>('SELECT * FROM density_checks WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!row) throw notFound('Density entry not found');
    assertDayOpen(String(row.station_id), String(row.business_date));
    run('DELETE FROM density_checks WHERE id = ?', [String(row.id)]);
    audit(req, {
      action: 'DENSITY_CHECK_DELETED', entity: 'DensityCheck', entityId: String(row.id), stationId: String(row.station_id),
      summary: `Density entry deleted (${String(row.business_date)}: ${String(row.density_at_15c)} kg/m³ @15°C)`,
      before: row as Record<string, unknown>,
    });
    return ok(res, { deleted: true });
  }),
);
