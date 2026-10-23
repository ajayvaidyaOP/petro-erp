import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, tx, type Row } from '../db/index.js';
import { asyncHandler, created, ok, pageMeta, paging, parse } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso, todayIst } from '../lib/time.js';
import { D, Decimal, money, rate as fmtRate } from '../lib/decimal.js';
import { evaluateReading, latestCountableReading, lastReading } from '../lib/meter.js';
import { priceAt } from '../lib/pricing.js';
import { allocateAcrossTanks, recordMovement } from '../lib/stock.js';
import { settingsValue } from '../lib/settings.js';

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
  return {
    ...(shape(shift as unknown as Row) as Record<string, unknown>),
    operatorName: operatorName(shift.operator_id),
    openedByName: operatorName(shift.opened_by),
    closedByName: operatorName(shift.closed_by),
    approvedByName: operatorName(shift.approved_by),
    nozzleReadings: shapeAll(nozzles),
    nozzles: shapeAll(nozzles),
    totals: {
      litres: shift.total_litres,
      value: shift.total_value,
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
    const hours = settingsValue('shifts.unclosedAlertHours', tenantId, null, 14);
    const rows = all<Record<string, unknown>>(
      `SELECT s.*, st.name AS station_name, u.name AS operator_name
         FROM shifts s JOIN stations st ON st.id = s.station_id
         LEFT JOIN users u ON u.id = s.operator_id
        WHERE s.tenant_id = ? AND s.status = 'OPEN'
        ORDER BY s.opened_at ASC`,
      [tenantId],
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

const openingReadingSchema = z.object({
  nozzleId: z.string().min(3),
  reading: z.union([z.string(), z.number()]).transform(String),
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
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        openingCash: z.union([z.string(), z.number()]).transform(String).optional(),
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
              evaluation.quality, manual.readingAt ?? nowIso(), evaluation.delta, previous?.id ?? null,
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
    const body = parse(
      z.object({
        openingReading: z.union([z.string(), z.number()]).transform(String).optional(),
        closingReading: z.union([z.string(), z.number()]).transform(String).optional(),
        adjustmentLitres: z.union([z.string(), z.number()]).transform(String).optional(),
        adjustmentReason: z.string().max(300).optional().nullable(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
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
      if (opening && closing) {
        const candidate = D(closing).minus(D(opening)).plus(adjustment);
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
    `SELECT snr.*, n.label, n.product_id, n.station_id, n.dispenser_id
       FROM shift_nozzle_readings snr JOIN nozzles n ON n.id = snr.nozzle_id
      WHERE snr.shift_id = ? ORDER BY snr.nozzle_id`,
    [shift.id],
  );
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
  }[] = [];

  for (const row of rows) {
    const nozzleId = String(row.nozzle_id);
    const manual = supplied.get(nozzleId);
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
            manual.readingAt ?? nowIso(), evaluation.delta, previous?.id ?? null,
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
    const rate = priceAt(shift.tenant_id, String(row.product_id), shift.station_id);
    let litres: string | null = null;
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
      if (raw.lt(0)) {
        status = 'FLAGGED';
        variance = raw.toFixed(3);
        note = note ?? 'Closing totalizer is lower than the opening value — reading reset or meter replacement suspected';
      } else {
        litres = adjusted.toFixed(3);
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
          .array(z.object({ nozzleId: z.string().min(3), reading: z.union([z.string(), z.number()]).transform(String) }))
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
    const body = parse(
      z.object({
        closingCash: z.union([z.string(), z.number()]).transform(String).optional(),
        notes: z.string().max(1000).optional().nullable(),
        readings: z
          .array(
            z.object({
              nozzleId: z.string().min(3),
              reading: z.union([z.string(), z.number()]).transform(String),
              readingAt: z.string().datetime().optional(),
            }),
          )
          .max(50)
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
        if (op.status === 'FLAGGED' || D(op.variance).abs().gt(tolerance)) flagged = true;
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

      // Stock movements are posted only on close, from countable litres. When a
      // grade is stored in more than one tank the volume is shared by book stock.
      for (const [productId, total] of productTotals) {
        if (total.litres.lte(0)) continue;
        for (const allocation of allocateAcrossTanks(shift.station_id, productId, total.litres)) {
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
            note: `Dispensed during shift #${shift.shift_number} (aggregate totalizer litres)`,
            createdBy: auth.user.id,
            isDemo: Boolean(shift.is_demo),
          });
        }
      }

      const status = flagged ? 'FLAGGED' : 'CLOSED';
      run(
        `UPDATE shifts SET status = ?, closed_at = ?, closed_by = ?, total_litres = ?, total_value = ?,
                closing_cash = ?, close_notes = ?, updated_at = ? WHERE id = ?`,
        [status, nowIso(), auth.user.id, totalLitres.toFixed(3), money(totalValue),
          fmtRate(D(body.closingCash ?? 0)), body.notes ?? null, nowIso(), shift.id],
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
        .map((row) => `${row.nozzle_label}: ${String(row.note ?? 'needs review')}`),
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
    if (!['CLOSED', 'FLAGGED'].includes(shift.status)) throw conflict('Only closed or flagged shifts can be reversed');
    const body = parse(z.object({ reason: z.string().min(10).max(1000) }), req.body);
    const rows = all<Record<string, unknown>>(
      `SELECT snr.litres_sold, n.product_id, n.station_id, st.tenant_id
         FROM shift_nozzle_readings snr
         JOIN nozzles n ON n.id = snr.nozzle_id
         JOIN stations st ON st.id = n.station_id
        WHERE snr.shift_id = ?`,
      [shift.id],
    );
    const byProduct = new Map<string, Decimal>();
    for (const row of rows) {
      if (!row.litres_sold) continue;
      const key = String(row.product_id);
      byProduct.set(key, (byProduct.get(key) ?? D(0)).plus(D(String(row.litres_sold))));
    }
    tx(() => {
      for (const [productId, litres] of byProduct) {
        if (litres.lte(0)) continue;
        // Reverse in the same proportions the original sale was allocated.
        for (const allocation of allocateAcrossTanks(shift.station_id, productId, litres)) {
          if (allocation.litres.lte(0)) continue;
          recordMovement({
            tenantId: shift.tenant_id,
            stationId: shift.station_id,
            tankId: allocation.tankId,
            productId,
            type: 'ADJUSTMENT',
            quantityLitres: allocation.litres.negated().toFixed(3),
            occurredAt: nowIso(),
            referenceType: 'SHIFT_REVERSAL',
            referenceId: shift.id,
            note: `Reversal of shift #${shift.shift_number}: ${body.reason}`,
            createdBy: auth.user.id,
            isDemo: Boolean(shift.is_demo),
          });
        }
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
