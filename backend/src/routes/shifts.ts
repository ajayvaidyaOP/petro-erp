import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, tx, type Row } from '../db/index.js';
import { asyncHandler, created, ok, pageMeta, paging, parse } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { isIsoDate, nowIso, todayIst } from '../lib/time.js';
import { D, Decimal, money, rate as fmtRate } from '../lib/decimal.js';
import { evaluateReading, latestCountableReading, lastReading } from '../lib/meter.js';
import { priceAt } from '../lib/pricing.js';
import { allocateAcrossTanks, recordMovement } from '../lib/stock.js';
import { settingsValue } from '../lib/settings.js';
import { assertDayOpen } from '../lib/dayclose.js';

export const shiftRouter = Router();
shiftRouter.use(requireAuth);

interface ShiftRow {
  id: string;
  tenant_id: string;
  station_id: string;
  shift_number: number;
  business_date: string;
  opened_at: string;
  closed_at: string | null;
  operator_id: string | null;
  status: string;
  total_litres: string;
  total_value: string;
  opening_cash: string;
  closing_cash: string;
  cash_counted: string | null;
  short_excess: string | null;
  notes: string | null;
  close_notes: string | null;
  opened_by: string | null;
  closed_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  is_demo: number;
}

interface NozzleRow {
  id: string;
  label: string;
  number: number;
  station_id: string;
  dispenser_id: string;
  product_id: string;
  dispenser_code: string;
  dispenser_name: string;
  product_name: string;
  product_code: string;
}

function shiftNozzles(stationId: string): NozzleRow[] {
  return all<NozzleRow>(
    `SELECT n.id, n.label, n.number, n.station_id, n.dispenser_id, n.product_id,
            d.code AS dispenser_code, d.name AS dispenser_name,
            p.name AS product_name, p.code AS product_code
       FROM nozzles n
       JOIN dispensers d ON d.id = n.dispenser_id
       JOIN fuel_products p ON p.id = n.product_id
      WHERE n.station_id = ? AND n.status = 'ACTIVE'
      ORDER BY d.code, n.number`,
    [stationId],
  );
}

function loadShift(auth: AuthContext, shiftId: string): ShiftRow {
  const shift = get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shiftId]);
  if (!shift) throw notFound('Shift not found');
  if (shift.tenant_id !== tenantIdOf(auth)) throw notFound('Shift not found');
  getStationOrThrow(auth, shift.station_id);
  return shift;
}

function operatorName(userId: string | null) {
  if (!userId) return null;
  return get<{ name: string }>('SELECT name FROM users WHERE id = ?', [userId])?.name ?? null;
}

function shiftDetail(shift: ShiftRow) {
  const nozzles = all<Record<string, unknown>>(
    `SELECT snr.*, n.label AS nozzle_label, n.number AS nozzle_number, d.code AS dispenser_code,
            p.name AS product_name, p.code AS product_code, p.color AS product_color
       FROM shift_nozzle_readings snr
       JOIN nozzles n ON n.id = snr.nozzle_id
       JOIN dispensers d ON d.id = n.dispenser_id
       JOIN fuel_products p ON p.id = n.product_id
      WHERE snr.shift_id = ? ORDER BY d.code, n.number`,
    [shift.id],
  );
  const station = get<{ name: string; code: string }>('SELECT name, code FROM stations WHERE id = ?', [shift.station_id]);
  const settlements = all<Record<string, unknown>>(
    'SELECT * FROM shift_settlements WHERE shift_id = ? ORDER BY mode',
    [shift.id],
  );
  const denominations = all<Record<string, unknown>>(
    'SELECT * FROM shift_cash_denominations WHERE shift_id = ? ORDER BY denomination DESC',
    [shift.id],
  );
  return {
    ...(shape(shift as unknown as Row) as Record<string, unknown>),
    stationName: station?.name ?? null,
    stationCode: station?.code ?? null,
    operatorName: operatorName(shift.operator_id),
    openedByName: operatorName(shift.opened_by),
    closedByName: operatorName(shift.closed_by),
    approvedByName: operatorName(shift.approved_by),
    nozzleReadings: shapeAll(nozzles),
    nozzles: shapeAll(nozzles),
    settlements: shapeAll(settlements),
    denominations: shapeAll(denominations),
    totals: {
      litres: shift.total_litres,
      value: shift.total_value,
      testingLitres: nozzles.reduce((acc, n) => acc.plus(D(String(n.testing_litres ?? '0'))), D(0)).toFixed(3),
      nozzleCount: nozzles.length,
      flaggedNozzles: nozzles.filter((n) => String(n.status) === 'FLAGGED').length,
    },
  };
}

// -------------------------------------------------------------------- list

shiftRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['s.tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) {
      getStationOrThrow(auth, stationId);
      clauses.push('s.station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`s.station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
      params.push(...ids);
    }
    for (const [key, column] of [['status', 's.status'], ['businessDate', 's.business_date']] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value) { clauses.push(`${column} = ?`); params.push(value); }
    }
    if (typeof req.query.from === 'string' && req.query.from) { clauses.push('s.business_date >= ?'); params.push(req.query.from); }
    if (typeof req.query.to === 'string' && req.query.to) { clauses.push('s.business_date <= ?'); params.push(req.query.to); }
    if (typeof req.query.operatorId === 'string' && req.query.operatorId) { clauses.push('s.operator_id = ?'); params.push(req.query.operatorId); }
    const where = clauses.join(' AND ');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM shifts s WHERE ${where}`, params)?.count ?? 0;
    const rows = all<Record<string, unknown>>(
      `SELECT s.*, st.name AS station_name, u.name AS operator_name
         FROM shifts s JOIN stations st ON st.id = s.station_id
         LEFT JOIN users u ON u.id = s.operator_id
        WHERE ${where} ORDER BY s.business_date DESC, s.shift_number DESC LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

shiftRouter.get(
  '/alerts',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const stationId = typeof req.query.stationId === 'string' && req.query.stationId ? req.query.stationId : null;
    if (stationId) getStationOrThrow(auth, stationId);
    const hours = settingsValue('shifts.unclosedAlertHours', tenantId, stationId, 14);
    const rows = all<Record<string, unknown>>(
      `SELECT s.*, st.name AS station_name, u.name AS operator_name
         FROM shifts s JOIN stations st ON st.id = s.station_id
         LEFT JOIN users u ON u.id = s.operator_id
        WHERE s.tenant_id = ? AND s.status = 'OPEN' ${stationId ? 'AND s.station_id = ?' : ''}
        ORDER BY s.opened_at ASC`,
      stationId ? [tenantId, stationId] : [tenantId],
    );
    const now = Date.now();
    const alerts = rows
      .filter((row) => {
        if (!auth.allStations && !auth.stationIds.has(String(row.station_id))) return false;
        return now - new Date(String(row.opened_at)).getTime() > Number(hours) * 3_600_000;
      })
      .map((row) => ({
        ...shape(row),
        hoursOpen: ((now - new Date(String(row.opened_at)).getTime()) / 3_600_000).toFixed(1),
      }));
    return ok(res, {
      thresholdHours: hours,
      count: alerts.length,
      alerts,
    });
  }),
);

// ------------------------------------------------------------- day closing
// NOTE: ye routes '/:id' se PEHLE rehne chahiye, warna 'day-closings' ko
// Express ek shift id samajh lega.

shiftRouter.get(
  '/day-closings',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : null;
    const rows = all<Record<string, unknown>>(
      `SELECT dc.*, uc.name AS closed_by_name, ur.name AS reopened_by_name
         FROM day_closings dc
         LEFT JOIN users uc ON uc.id = dc.closed_by
         LEFT JOIN users ur ON ur.id = dc.reopened_by
        WHERE dc.station_id = ? ${month ? "AND dc.business_date LIKE ?" : ''}
        ORDER BY dc.business_date DESC LIMIT 93`,
      month ? [station.id, `${month}%`] : [station.id],
    );
    return ok(res, shapeAll(rows));
  }),
);

shiftRouter.post(
  '/day-close',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'dayclose.manage')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        businessDate: z.string().refine(isIsoDate, 'Enter a valid YYYY-MM-DD date'),
        notes: z.string().max(500).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    if (body.businessDate > todayIst()) throw unprocessable('A future business date cannot be closed');
    const openShift = get<{ id: string; shift_number: number; business_date: string }>(
      "SELECT id, shift_number, business_date FROM shifts WHERE station_id = ? AND status = 'OPEN' AND business_date <= ? ORDER BY opened_at ASC LIMIT 1",
      [station.id, body.businessDate],
    );
    if (openShift) {
      throw conflict(`Shift #${openShift.shift_number} (${openShift.business_date}) is still open — close it before closing the day.`);
    }
    const existing = get<{ id: string; status: string }>(
      'SELECT id, status FROM day_closings WHERE station_id = ? AND business_date = ?',
      [station.id, body.businessDate],
    );
    if (existing?.status === 'CLOSED') throw conflict(`Business date ${body.businessDate} is already closed`);
    const id = existing?.id ?? newId('dcl');
    tx(() => {
      if (existing) {
        run(
          "UPDATE day_closings SET status = 'CLOSED', closed_by = ?, closed_at = ?, notes = COALESCE(?, notes) WHERE id = ?",
          [auth.user.id, nowIso(), body.notes ?? null, existing.id],
        );
      } else {
        run(
          `INSERT INTO day_closings (id, tenant_id, station_id, business_date, status, closed_by, closed_at, notes, created_at)
           VALUES (?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?)`,
          [id, station.tenant_id, station.id, body.businessDate, auth.user.id, nowIso(), body.notes ?? null, nowIso()],
        );
      }
    });
    audit(req, {
      action: 'DAY_CLOSED', entity: 'DayClosing', entityId: id, stationId: station.id,
      summary: `Business date ${body.businessDate} closed (din band)`,
      after: { businessDate: body.businessDate },
    });
    return created(res, shape(get('SELECT * FROM day_closings WHERE id = ?', [id])));
  }),
);

shiftRouter.post(
  '/day-close/reopen',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'dayclose.manage')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        businessDate: z.string().refine(isIsoDate, 'Enter a valid YYYY-MM-DD date'),
        reason: z.string().min(10).max(500),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const existing = get<{ id: string; status: string }>(
      'SELECT id, status FROM day_closings WHERE station_id = ? AND business_date = ?',
      [station.id, body.businessDate],
    );
    if (!existing || existing.status !== 'CLOSED') throw conflict(`Business date ${body.businessDate} is not closed`);
    run(
      "UPDATE day_closings SET status = 'REOPENED', reopened_by = ?, reopened_at = ?, reopen_reason = ? WHERE id = ?",
      [auth.user.id, nowIso(), body.reason, existing.id],
    );
    audit(req, {
      action: 'DAY_REOPENED', entity: 'DayClosing', entityId: existing.id, stationId: station.id,
      summary: `Business date ${body.businessDate} reopened: ${body.reason}`,
      before: { status: 'CLOSED' },
      after: { businessDate: body.businessDate, reason: body.reason },
    });
    return ok(res, shape(get('SELECT * FROM day_closings WHERE id = ?', [existing.id])));
  }),
);

shiftRouter.get(
  '/:id',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.read')) throw forbidden();
    const shift = loadShift(auth, req.params.id);
    return ok(res, shiftDetail(shift));
  }),
);

// -------------------------------------------------------------------- open

const nonNegativeDecimal = z.union([
  z.string().trim().max(40).regex(/^(?:\d+(?:\.\d+)?|\.\d+)$/, 'Enter a non-negative number'),
  z.number().finite().nonnegative(),
]).transform(String);
const signedDecimal = z.union([
  z.string().trim().max(40).regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/, 'Enter a valid number'),
  z.number().finite(),
]).transform(String);

const openingReadingSchema = z.object({
  nozzleId: z.string().min(3),
  reading: nonNegativeDecimal,
  readingAt: z.string().datetime().optional(),
});

shiftRouter.post(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.open')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        operatorId: z.string().min(3).optional().nullable(),
        shiftNumber: z.coerce.number().int().min(1).max(20).optional(),
        businessDate: z.string().refine(isIsoDate, 'Enter a valid YYYY-MM-DD date').optional(),
        openingCash: nonNegativeDecimal.optional(),
        notes: z.string().max(500).optional().nullable(),
        captureReadings: z.boolean().optional(),
        openingReadings: z.array(openingReadingSchema).max(50).optional(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    if (body.operatorId) {
      const operator = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ? AND tenant_id = ?', [
        body.operatorId, station.tenant_id,
      ]);
      if (!operator) throw notFound('Operator not found');
      if (!['OPERATOR', 'CASHIER', 'MANAGER', 'OWNER'].includes(String(operator.role_key))) {
        throw unprocessable('Selected employee cannot be assigned as a shift operator');
      }
    }
    const businessDate = body.businessDate ?? todayIst();
    assertDayOpen(station.id, businessDate);
    const open = get<{ id: string; shift_number: number }>(
      "SELECT id, shift_number FROM shifts WHERE station_id = ? AND status IN ('OPEN','FLAGGED') ORDER BY opened_at DESC LIMIT 1",
      [station.id],
    );
    if (open) throw conflict(`Shift #${open.shift_number} is still open. Close it before opening a new shift.`);
    const existingNumbers = all<{ shift_number: number }>(
      'SELECT shift_number FROM shifts WHERE station_id = ? AND business_date = ?',
      [station.id, businessDate],
    ).map((r) => r.shift_number);
    const shiftNumber = body.shiftNumber ?? Math.max(0, ...existingNumbers) + 1;
    if (existingNumbers.includes(shiftNumber)) {
      throw conflict(`Shift #${shiftNumber} already exists for ${businessDate}`);
    }

    const nozzles = shiftNozzles(station.id);
    if (nozzles.length === 0) throw unprocessable('Configure nozzles before opening a shift');
    const supplied = new Map((body.openingReadings ?? []).map((r) => [r.nozzleId, r]));
    for (const nozzleId of supplied.keys()) {
      if (!nozzles.some((n) => n.id === nozzleId)) throw unprocessable('Opening reading references a nozzle outside this station');
    }

    const shiftId = newId('sft');
    const missing: string[] = [];
    tx(() => {
      run(
        `INSERT INTO shifts
          (id, tenant_id, station_id, shift_number, business_date, opened_at, operator_id, opened_by, status,
           total_litres, total_value, opening_cash, closing_cash, notes, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', '0', '0', ?, '0', ?, 0, ?, ?)`,
        [shiftId, station.tenant_id, station.id, shiftNumber, businessDate, nowIso(),
          body.operatorId ?? auth.user.id, auth.user.id, fmtRate(D(body.openingCash ?? 0)),
          body.notes ?? null, nowIso(), nowIso()],
      );
      for (const nozzle of nozzles) {
        const manual = supplied.get(nozzle.id);
        let openingReading: string | null = null;
        let openingReadingId: string | null = null;
        let source: string | null = null;
        if (manual) {
          const previous = latestCountableReading(nozzle.id);
          const evaluation = evaluateReading(
            { value: fmtRate(D(manual.reading)), unit: 'L', readingAt: manual.readingAt ?? nowIso() },
            previous,
            { maxJumpLitres: settingsValue('hardware.maxJumpLitres', station.tenant_id, station.id, 10000) },
          );
          openingReadingId = newId('rdg');
          run(
            `INSERT INTO meter_readings
              (id, tenant_id, station_id, nozzle_id, reading_value, unit, quality, source, reading_at,
               sequence, delta_litres, previous_reading_id, is_countable, is_simulated, note, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, 'L', ?, 'MANUAL', ?, 0, ?, ?, ?, 0, ?, ?, ?)`,
            [openingReadingId, station.tenant_id, station.id, nozzle.id, fmtRate(D(manual.reading)),
              evaluation.quality, manual.readingAt ?? nowIso(), evaluation.delta?.toFixed(3) ?? null, previous?.id ?? null,
              evaluation.countable ? 1 : 0, 'Shift opening reading captured manually', auth.user.id, nowIso()],
          );
          openingReading = fmtRate(D(manual.reading));
          source = 'MANUAL';
        } else if (body.captureReadings === false) {
          source = null;
          missing.push(nozzle.label);
        } else {
          const latest = latestCountableReading(nozzle.id);
          if (latest) {
            openingReading = latest.reading_value ?? null;
            openingReadingId = latest.id ?? null;
            source = 'DEVICE';
          } else {
            missing.push(nozzle.label);
          }
        }
        run(
          `INSERT INTO shift_nozzle_readings
            (id, shift_id, nozzle_id, opening_reading, opening_reading_id, opening_source, adjustment_litres,
             status, note, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, '0', 'PENDING', ?, ?, ?)`,
          [newId('snr'), shiftId, nozzle.id, openingReading, openingReadingId, source,
            openingReading ? null : 'No opening reading available', nowIso(), nowIso()],
        );
      }
    });

    audit(req, {
      action: 'SHIFT_OPENED', entity: 'Shift', entityId: shiftId, stationId: station.id,
      summary: `Shift #${shiftNumber} opened for ${businessDate}${missing.length ? `; ${missing.length} nozzle(s) without a baseline` : ''}`,
      after: { shiftNumber, businessDate, operatorId: body.operatorId ?? auth.user.id, missingNozzles: missing },
    });
    return created(res, {
      ...shiftDetail(get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shiftId])!),
      warnings: missing.length
        ? [`No prior totalizer reading for: ${missing.join(', ')}. Capture opening readings before closing this shift.`]
        : [],
    });
  }),
);

// -------------------------------------------------- manual nozzle overrides

shiftRouter.patch(
  '/:id/nozzles/:nozzleId',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.close')) throw forbidden();
    const shift = loadShift(auth, req.params.id);
    if (shift.status !== 'OPEN') throw conflict('Only open shifts can be edited. Use a reversal for closed shifts.');
    const row = get<Record<string, unknown>>(
      'SELECT * FROM shift_nozzle_readings WHERE shift_id = ? AND nozzle_id = ?',
      [shift.id, req.params.nozzleId],
    );
    if (!row) throw notFound('Nozzle reading not found for this shift');
    assertDayOpen(shift.station_id, shift.business_date);
    const body = parse(
      z.object({
        openingReading: nonNegativeDecimal.optional(),
        closingReading: nonNegativeDecimal.optional(),
        testingLitres: nonNegativeDecimal.optional(),
        operatorId: z.string().min(3).optional().nullable(),
        adjustmentLitres: signedDecimal.optional(),
        adjustmentReason: z.string().max(300).optional().nullable(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    if (body.operatorId) {
      const operator = get('SELECT id FROM users WHERE id = ? AND tenant_id = ?', [body.operatorId, shift.tenant_id]);
      if (!operator) throw notFound('Operator not found');
    }
    if ((body.openingReading !== undefined || body.closingReading !== undefined)
      && !settingsValue('hardware.allowManualFallback', shift.tenant_id, shift.station_id, 1)) {
      throw forbidden('Manual reading entry is disabled in station settings');
    }
    const adjustment = body.adjustmentLitres ?? String(row.adjustment_litres ?? '0');
    const reason = body.adjustmentReason ?? row.adjustment_reason;
    if (!D(adjustment).isZero() && (typeof reason !== 'string' || !reason.trim())) {
      throw unprocessable('An adjustment reason is required when adjusting litres');
    }
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (body.openingReading !== undefined) {
      sets.push('opening_reading = ?', "opening_source = 'MANUAL'");
      params.push(fmtRate(D(body.openingReading)));
    }
    if (body.closingReading !== undefined) {
      sets.push('closing_reading = ?', "closing_source = 'MANUAL'");
      params.push(fmtRate(D(body.closingReading)));
    }
    if (body.adjustmentLitres !== undefined) {
      sets.push('adjustment_litres = ?');
      params.push(fmtRate(D(body.adjustmentLitres)));
    }
    if (body.adjustmentReason !== undefined) {
      sets.push('adjustment_reason = ?');
      params.push(body.adjustmentReason);
    }
    if (body.testingLitres !== undefined) {
      sets.push('testing_litres = ?');
      params.push(fmtRate(D(body.testingLitres)));
    }
    if (body.operatorId !== undefined) {
      sets.push('operator_id = ?');
      params.push(body.operatorId);
    }
    if (body.note !== undefined) {
      sets.push('note = ?');
      params.push(body.note);
    }
    if (sets.length > 0) {
      run(`UPDATE shift_nozzle_readings SET ${sets.join(', ')}, status = 'PENDING', updated_at = ? WHERE id = ?`, [
        ...params, nowIso(), String(row.id),
      ]);
    }
    // Recompute litres from the stored (possibly manual) readings so the UI
    // always shows closing − opening + adjustment for this nozzle.
    const updated = get<Record<string, unknown>>('SELECT * FROM shift_nozzle_readings WHERE id = ?', [String(row.id)]);
    if (updated) {
      const opening = updated.opening_reading as string | null;
      const closing = updated.closing_reading as string | null;
      const adjustment = D(updated.adjustment_litres as string);
      // Testing fuel (5L calibration/sample) nozzle se nikal kar tank me wapas
      // jata hai — wo sale nahi hai, isliye net litres se minus hota hai.
      const testing = D((updated.testing_litres as string | null) ?? '0');
      if (opening && closing) {
        const candidate = D(closing).minus(D(opening)).plus(adjustment).minus(testing);
        const nozzleProduct = get<{ product_id: string }>('SELECT product_id FROM nozzles WHERE id = ?', [req.params.nozzleId]);
        const price = nozzleProduct ? priceAt(shift.tenant_id, nozzleProduct.product_id, shift.station_id) : null;
        if (candidate.lt(0)) {
          run('UPDATE shift_nozzle_readings SET litres_sold = NULL, sales_value = ? , rate = ?, variance_litres = ?, status = ?, updated_at = ? WHERE id = ?', [
            '0.00', price?.rate ?? '0', candidate.toFixed(3), 'FLAGGED', nowIso(), String(row.id),
          ]);
        } else {
          run('UPDATE shift_nozzle_readings SET litres_sold = ?, rate = ?, sales_value = ?, status = ?, updated_at = ? WHERE id = ?', [
            candidate.toFixed(3), price?.rate ?? '0', money(candidate.mul(D(price?.rate ?? 0))), 'CAPTURED', nowIso(), String(row.id),
          ]);
        }
      }
    }
    audit(req, {
      action: 'SHIFT_NOZZLE_EDITED', entity: 'ShiftNozzleReading', entityId: String(row.id),
      stationId: shift.station_id,
      summary: `Manual values recorded for shift #${shift.shift_number}`,
      before: { opening: row.opening_reading, closing: row.closing_reading, adjustment: row.adjustment_litres },
      after: body,
    });
    return ok(res, shiftDetail(get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shift.id])!));
  }),
);

// ------------------------------------------------------------------ capture

function captureClosings(
  shift: ShiftRow,
  auth: AuthContext,
  supplied: Map<string, { reading: string; readingAt?: string }>,
  options: { commit: boolean },
) {
  const rows = all<Record<string, unknown>>(
    `SELECT snr.*, n.label, n.product_id, n.station_id, n.dispenser_id, n.tank_id
       FROM shift_nozzle_readings snr JOIN nozzles n ON n.id = snr.nozzle_id
      WHERE snr.shift_id = ? ORDER BY snr.nozzle_id`,
    [shift.id],
  );
  const nozzleIds = new Set(rows.map((row) => String(row.nozzle_id)));
  for (const nozzleId of supplied.keys()) {
    if (!nozzleIds.has(nozzleId)) throw unprocessable('Closing reading references a nozzle outside this shift');
  }
  const maxJump = settingsValue('hardware.maxJumpLitres', shift.tenant_id, shift.station_id, 10000);
  const allowManual = settingsValue('hardware.allowManualFallback', shift.tenant_id, shift.station_id, 1);
  const operations: {
    rowId: string;
    nozzleId: string;
    label: string;
    productId: string;
    opening: string | null;
    closing: string | null;
    closingReadingId: string | null;
    source: string | null;
    litres: string | null;
    rate: string;
    value: string;
    variance: string;
    status: string;
    note: string | null;
    adjustment: string;
    testing: string;
    grossLitres: string | null;
    tankId: string | null;
  }[] = [];

  for (const row of rows) {
    const nozzleId = String(row.nozzle_id);
    // The shift editor saves manual closings before the user presses Close.
    // Reuse those values unless the close request supplies a newer override;
    // otherwise closing silently replaced them with device readings.
    const savedManual: { reading: string; readingAt?: string } | undefined = row.closing_source === 'MANUAL' && row.closing_reading != null
      ? { reading: String(row.closing_reading) }
      : undefined;
    const manual = supplied.get(nozzleId) ?? savedManual;
    if (manual && !allowManual) {
      throw forbidden('Manual closing capture is disabled in station settings');
    }
    let closing: string | null = null;
    let closingReadingId: string | null = null;
    let source: string | null = null;
    let note: string | null = null;
    const deviceReading = latestCountableReading(nozzleId);
    const deviceValue = deviceReading && new Date(String(deviceReading.reading_at ?? 0)).getTime() >= new Date(shift.opened_at).getTime()
      ? deviceReading
      : null;

    if (manual) {
      closing = fmtRate(D(manual.reading));
      source = 'MANUAL';
      if (deviceValue) {
        const diff = D(closing).minus(D(deviceValue.reading_value));
        if (diff.abs().gt(0)) note = `Manual closing differs from last device reading (${deviceValue.reading_value}) by ${diff.toFixed(3)} L`;
      }
      if (options.commit) {
        const previous = lastReading(nozzleId);
        const evaluation = evaluateReading(
          { value: closing, unit: 'L', readingAt: manual.readingAt ?? nowIso() },
          previous,
          { maxJumpLitres: maxJump },
        );
        closingReadingId = newId('rdg');
        run(
          `INSERT INTO meter_readings
            (id, tenant_id, station_id, nozzle_id, reading_value, unit, quality, source, reading_at, sequence,
             delta_litres, previous_reading_id, is_countable, is_simulated, note, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, 'L', ?, 'MANUAL', ?, 0, ?, ?, ?, 0, ?, ?, ?)`,
          [closingReadingId, shift.tenant_id, shift.station_id, nozzleId, closing, evaluation.quality,
            manual.readingAt ?? nowIso(), evaluation.delta?.toFixed(3) ?? null, previous?.id ?? null,
            evaluation.countable ? 1 : 0, 'Shift closing capture', auth.user.id, nowIso()],
        );
      }
    } else if (deviceValue) {
      closing = deviceValue.reading_value ?? null;
      closingReadingId = deviceValue.id ?? null;
      source = 'DEVICE';
      note = 'Auto-captured from the latest countable device reading';
    }

    const opening = row.opening_reading as string | null;
    const adjustment = String(row.adjustment_litres ?? '0');
    const testing = D(String(row.testing_litres ?? '0'));
    const rate = priceAt(shift.tenant_id, String(row.product_id), shift.station_id);
    let litres: string | null = null;
    let grossLitres: string | null = null;
    let variance = '0';
    let status = 'CAPTURED';
    if (!opening) {
      status = 'FLAGGED';
      note = note ?? 'No opening reading — litres cannot be computed';
    } else if (!closing) {
      status = 'FLAGGED';
      note = note ?? 'No closing reading captured — record a manual reading or reconnect the device';
    } else {
      const raw = D(closing).minus(D(opening));
      const adjusted = raw.plus(D(adjustment));
      grossLitres = adjusted.gte(0) ? adjusted.toFixed(3) : null;
      // Net billable litres = metered - testing (testing fuel tank me wapas jata hai).
      const net = adjusted.minus(testing);
      if (raw.lt(0) || adjusted.lt(0) || net.lt(0)) {
        status = 'FLAGGED';
        variance = (raw.lt(0) ? raw : net).toFixed(3);
        note = note ?? (raw.lt(0)
          ? 'Closing totalizer is lower than the opening value — reading reset or meter replacement suspected'
          : net.lt(0)
            ? 'Testing quantity exceeds the metered litres for this nozzle'
            : 'The adjustment would make net litres negative');
      } else {
        litres = net.toFixed(3);
      }
      if (manual && deviceValue) {
        variance = D(closing).minus(D(deviceValue.reading_value)).toFixed(3);
      }
    }
    operations.push({
      rowId: String(row.id),
      nozzleId,
      label: String(row.label),
      productId: String(row.product_id),
      opening,
      closing,
      closingReadingId,
      source,
      litres,
      rate: rate?.rate ?? '0',
      value: litres ? money(D(litres).mul(D(rate?.rate ?? 0))) : '0.00',
      variance,
      status,
      note,
      adjustment,
      testing: testing.toFixed(3),
      grossLitres,
      tankId: (row.tank_id as string | null) ?? null,
    });
  }
  return operations;
}

shiftRouter.post(
  '/:id/capture',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.close')) throw forbidden();
    const shift = loadShift(auth, req.params.id);
    if (shift.status !== 'OPEN') throw conflict('Readings can only be captured for an open shift');
    const body = parse(
      z.object({
        readings: z
          .array(z.object({ nozzleId: z.string().min(3), reading: nonNegativeDecimal }))
          .max(50)
          .optional(),
      }),
      req.body ?? {},
    );
    const operations = captureClosings(
      shift,
      auth,
      new Map((body.readings ?? []).map((r) => [r.nozzleId, { reading: r.reading }])),
      { commit: false },
    );
    return ok(res, {
      shiftId: shift.id,
      preview: operations.map((op) => ({
        nozzleId: op.nozzleId,
        nozzle: op.label,
        opening: op.opening,
        closing: op.closing,
        source: op.source,
        litres: op.litres,
        grossLitres: op.grossLitres,
        testingLitres: op.testing,
        rate: op.rate,
        value: op.value,
        variance: op.variance,
        status: op.status,
        note: op.note,
      })),
      note: 'Preview only — no readings or stock movements were written.',
    });
  }),
);

// -------------------------------------------------------------------- close

shiftRouter.post(
  '/:id/close',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.close')) throw forbidden();
    const shift = loadShift(auth, req.params.id);
    if (shift.status !== 'OPEN') throw conflict('This shift is not open');
    assertDayOpen(shift.station_id, shift.business_date);
    const body = parse(
      z.object({
        closingCash: nonNegativeDecimal.optional(),
        notes: z.string().max(1000).optional().nullable(),
        readings: z
          .array(
            z.object({
              nozzleId: z.string().min(3),
              reading: nonNegativeDecimal,
              readingAt: z.string().datetime().optional(),
            }),
          )
          .max(50)
          .optional(),
        // Galle ki ginti note-wise (₹500 x n ...) — cash counted isse banta hai.
        denominations: z
          .array(z.object({ denomination: z.coerce.number().int().positive(), count: z.coerce.number().int().min(0).max(100000) }))
          .max(12)
          .optional(),
        // Mode-wise mila hua paisa (UPI/Card machine totals, credit slips...).
        settlements: z
          .array(z.object({
            mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT']),
            received: nonNegativeDecimal,
            note: z.string().max(200).optional().nullable(),
          }))
          .max(8)
          .optional(),
      }),
      req.body ?? {},
    );
    const supplied = new Map((body.readings ?? []).map((r) => [r.nozzleId, { reading: r.reading, readingAt: r.readingAt }]));
    const tolerance = settingsValue('shifts.varianceToleranceLitres', shift.tenant_id, shift.station_id, 1);

    const result = tx(() => {
      const operations = captureClosings(shift, auth, supplied, { commit: true });
      let totalLitres = D(0);
      let totalValue = D(0);
      let flagged = operations.length === 0;
      const productTotals = new Map<string, { litres: Decimal; label: string }>();

      for (const op of operations) {
        if (D(op.variance).abs().gt(tolerance)) {
          op.status = 'FLAGGED';
          op.note = op.note ?? 'Variance exceeds the configured tolerance';
        }
        if (op.status === 'FLAGGED') flagged = true;
        if (op.litres) {
          totalLitres = totalLitres.plus(D(op.litres));
          totalValue = totalValue.plus(D(op.value));
          const entry = productTotals.get(op.productId) ?? { litres: D(0), label: op.label };
          entry.litres = entry.litres.plus(D(op.litres));
          productTotals.set(op.productId, entry);
        }
        run(
          `UPDATE shift_nozzle_readings
              SET closing_reading = ?, closing_reading_id = ?, closing_source = ?, litres_sold = ?, rate = ?,
                  sales_value = ?, variance_litres = ?, status = ?, note = ?, updated_at = ?
            WHERE id = ?`,
          [op.closing, op.closingReadingId, op.source, op.litres, op.rate, op.value, op.variance,
            op.status, op.note, nowIso(), op.rowId],
        );
      }

      // Stock movements are posted only on close, from countable net litres
      // (metered - testing). Har nozzle apne FIX tank se fuel khinchta hai:
      // tank mapped hai to movement seedha usi tank par; unmapped nozzle ka
      // volume hi purane pro-rata pool se banta hai (backward compatibility).
      void productTotals;
      const pool = new Map<string, Decimal>();
      for (const op of operations) {
        if (!op.litres || D(op.litres).lte(0)) continue;
        if (op.tankId) {
          recordMovement({
            tenantId: shift.tenant_id,
            stationId: shift.station_id,
            tankId: op.tankId,
            productId: op.productId,
            type: 'DISPENSED',
            quantityLitres: D(op.litres).toFixed(3),
            occurredAt: nowIso(),
            referenceType: 'SHIFT',
            referenceId: shift.id,
            note: `Dispensed during shift #${shift.shift_number} via ${op.label}${D(op.testing).gt(0) ? ` (net of ${op.testing} L testing returned)` : ''}`,
            createdBy: auth.user.id,
            isDemo: Boolean(shift.is_demo),
          });
        } else {
          pool.set(op.productId, (pool.get(op.productId) ?? D(0)).plus(D(op.litres)));
        }
      }
      for (const [productId, litres] of pool) {
        if (litres.lte(0)) continue;
        for (const allocation of allocateAcrossTanks(shift.station_id, productId, litres)) {
          if (allocation.litres.lte(0)) continue;
          recordMovement({
            tenantId: shift.tenant_id,
            stationId: shift.station_id,
            tankId: allocation.tankId,
            productId,
            type: 'DISPENSED',
            quantityLitres: allocation.litres.toFixed(3),
            occurredAt: nowIso(),
            referenceType: 'SHIFT',
            referenceId: shift.id,
            note: `Dispensed during shift #${shift.shift_number} (unmapped nozzle — pooled by book stock)`,
            createdBy: auth.user.id,
            isDemo: Boolean(shift.is_demo),
          });
        }
      }

      // ----- Paise ka milaan: expected (system) vs received (galla) -----
      const denomRows = body.denominations ?? [];
      const denomTotal = denomRows.reduce((acc, d) => acc.plus(D(d.denomination).mul(d.count)), D(0));
      run('DELETE FROM shift_cash_denominations WHERE shift_id = ?', [shift.id]);
      for (const d of denomRows) {
        if (d.count <= 0) continue;
        run(
          'INSERT INTO shift_cash_denominations (id, shift_id, denomination, count, amount) VALUES (?, ?, ?, ?, ?)',
          [newId('sdn'), shift.id, d.denomination, d.count, money(D(d.denomination).mul(d.count))],
        );
      }
      const recorded = all<{ payment_mode: string; amount: string }>(
        'SELECT payment_mode, amount FROM fuel_transactions WHERE shift_id = ? AND voided_at IS NULL',
        [shift.id],
      );
      const expectedByMode = new Map<string, Decimal>();
      for (const row of recorded) {
        expectedByMode.set(row.payment_mode, (expectedByMode.get(row.payment_mode) ?? D(0)).plus(D(row.amount)));
      }
      const recordedTotal = [...expectedByMode.values()].reduce((acc, v) => acc.plus(v), D(0));
      const remainder = totalValue.minus(recordedTotal);
      // Totalizer-aggregate duniya me jo bikri transaction-wise record nahi hui
      // wo aam taur par cash hoti hai — remainder CASH expected me jodte hain.
      if (remainder.gt(0)) {
        expectedByMode.set('CASH', (expectedByMode.get('CASH') ?? D(0)).plus(remainder));
      }
      const receivedByMode = new Map<string, { received: Decimal; note?: string | null }>();
      for (const entry of body.settlements ?? []) {
        receivedByMode.set(entry.mode, { received: D(entry.received), note: entry.note });
      }
      const cashReceived = receivedByMode.get('CASH')?.received
        ?? (denomRows.length > 0 ? denomTotal : null);
      run('DELETE FROM shift_settlements WHERE shift_id = ?', [shift.id]);
      let shortExcess = D(0);
      let anyReceived = false;
      for (const mode of ['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT'] as const) {
        const expected = expectedByMode.get(mode) ?? D(0);
        const received = mode === 'CASH' ? cashReceived : receivedByMode.get(mode)?.received ?? null;
        if (expected.isZero() && received === null) continue;
        const difference = received !== null ? received.minus(expected) : null;
        if (difference !== null) { shortExcess = shortExcess.plus(difference); anyReceived = true; }
        run(
          `INSERT INTO shift_settlements
            (id, shift_id, tenant_id, station_id, mode, expected_amount, received_amount, difference_amount, note, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [newId('sst'), shift.id, shift.tenant_id, shift.station_id, mode, money(expected),
            received !== null ? money(received) : null, difference !== null ? money(difference) : null,
            receivedByMode.get(mode)?.note ?? null, nowIso()],
        );
      }
      const cashCounted = denomRows.length > 0 ? denomTotal : cashReceived;

      const status = flagged ? 'FLAGGED' : 'CLOSED';
      run(
        `UPDATE shifts SET status = ?, closed_at = ?, closed_by = ?, total_litres = ?, total_value = ?,
                closing_cash = ?, cash_counted = ?, short_excess = ?, close_notes = ?, updated_at = ? WHERE id = ?`,
        [status, nowIso(), auth.user.id, totalLitres.toFixed(3), money(totalValue),
          fmtRate(D(body.closingCash ?? (cashCounted !== null ? money(cashCounted) : 0))),
          cashCounted !== null ? money(cashCounted) : null,
          anyReceived ? money(shortExcess) : null,
          body.notes ?? null, nowIso(), shift.id],
      );
      return { status, totalLitres: totalLitres.toFixed(3), totalValue: money(totalValue), operations };
    });

    audit(req, {
      action: result.status === 'FLAGGED' ? 'SHIFT_CLOSE_FLAGGED' : 'SHIFT_CLOSED',
      entity: 'Shift', entityId: shift.id, stationId: shift.station_id,
      summary: `Shift #${shift.shift_number} ${result.status.toLowerCase()}: ${result.totalLitres} L, ₹${result.totalValue}`,
      after: {
        litres: result.totalLitres,
        value: result.totalValue,
        flaggedNozzles: result.operations.filter((o) => o.status === 'FLAGGED').map((o) => o.label),
      },
    });
    const detail = shiftDetail(get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shift.id])!);
    return ok(res, {
      ...detail,
      warnings: detail.nozzleReadings
        .filter((row) => String(row.status) === 'FLAGGED')
        .map((row) => `${row.nozzleLabel}: ${String(row.note ?? 'needs review')}`),
    });
  }),
);

// ----------------------------------------------------------------- approve

shiftRouter.post(
  '/:id/approve',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.approve')) throw forbidden();
    const shift = loadShift(auth, req.params.id);
    if (!['FLAGGED', 'CLOSED'].includes(shift.status)) {
      throw conflict('Only closed or flagged shifts can be approved');
    }
    if (shift.status === 'CLOSED' && shift.approved_at) throw conflict('Shift is already approved');
    if (shift.closed_by === auth.user.id && auth.user.roleKey !== 'OWNER') {
      throw forbidden('A shift must be approved by someone other than the person who closed it');
    }
    const body = parse(z.object({ note: z.string().max(500).optional().nullable() }), req.body ?? {});
    tx(() => {
      run(
        `UPDATE shifts SET status = 'CLOSED', approved_by = ?, approved_at = ?, close_notes = ?, updated_at = ? WHERE id = ?`,
        [auth.user.id, nowIso(), body.note ?? shift.close_notes, nowIso(), shift.id],
      );
      run("UPDATE shift_nozzle_readings SET status = 'APPROVED', updated_at = ? WHERE shift_id = ? AND status != 'REVERSED'", [
        nowIso(), shift.id,
      ]);
    });
    audit(req, {
      action: 'SHIFT_APPROVED', entity: 'Shift', entityId: shift.id, stationId: shift.station_id,
      summary: `Shift #${shift.shift_number} approved${body.note ? `: ${body.note}` : ''}`,
    });
    return ok(res, shiftDetail(get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shift.id])!));
  }),
);

// ----------------------------------------------------------------- reverse

shiftRouter.post(
  '/:id/reverse',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'shifts.approve')) throw forbidden();
    const shift = loadShift(auth, req.params.id);
    assertDayOpen(shift.station_id, shift.business_date);
    if (!['CLOSED', 'FLAGGED'].includes(shift.status)) throw conflict('Only closed or flagged shifts can be reversed');
    const body = parse(z.object({ reason: z.string().min(10).max(1000) }), req.body);
    // Reverse the actual posted movements, not a fresh allocation based on
    // today's tank balances. Tanks may have changed since the shift closed.
    const movements = all<{ tank_id: string; product_id: string; quantity_litres: string }>(
      `SELECT tank_id, product_id, quantity_litres FROM stock_movements
        WHERE reference_type = 'SHIFT' AND reference_id = ? AND type = 'DISPENSED'`,
      [shift.id],
    );
    tx(() => {
      for (const movement of movements) {
        const litres = D(movement.quantity_litres).abs();
        if (litres.isZero()) continue;
        recordMovement({
          tenantId: shift.tenant_id,
          stationId: shift.station_id,
          tankId: movement.tank_id,
          productId: movement.product_id,
          type: 'ADJUSTMENT',
          quantityLitres: litres.negated().toFixed(3),
          occurredAt: nowIso(),
          referenceType: 'SHIFT_REVERSAL',
          referenceId: shift.id,
          note: `Reversal of shift #${shift.shift_number}: ${body.reason}`,
          createdBy: auth.user.id,
          isDemo: Boolean(shift.is_demo),
        });
      }
      run("UPDATE shifts SET status = 'REVERSED', close_notes = ?, updated_at = ? WHERE id = ?", [
        `${shift.close_notes ? `${shift.close_notes}\n` : ''}REVERSED: ${body.reason}`, nowIso(), shift.id,
      ]);
      run("UPDATE shift_nozzle_readings SET status = 'REVERSED', updated_at = ? WHERE shift_id = ?", [nowIso(), shift.id]);
    });
    audit(req, {
      action: 'SHIFT_REVERSED', entity: 'Shift', entityId: shift.id, stationId: shift.station_id,
      summary: `Shift #${shift.shift_number} reversed: ${body.reason}`,
      before: { status: shift.status, litres: shift.total_litres, value: shift.total_value },
    });
    return ok(res, shiftDetail(get<ShiftRow>('SELECT * FROM shifts WHERE id = ?', [shift.id])!));
  }),
);
