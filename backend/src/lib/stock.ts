import { all, get, run } from '../db/index.js';
import { unprocessable } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import { D, Decimal, percent } from './decimal.js';
import { signedMovement } from './meter.js';

/**
 * Signed contribution of a stock movement. Adjustments store the variance
 * between book and measured stock and are applied with the opposite sign.
 */
export function signedLitres(type: string, quantity: string): Decimal {
  return signedMovement(type, quantity);
}

export function tankBookStock(tankId: string): Decimal {
  const rows = all<{ type: string; quantity_litres: string }>(
    'SELECT type, quantity_litres FROM stock_movements WHERE tank_id = ?',
    [tankId],
  );
  return rows.reduce((acc, row) => acc.plus(signedLitres(row.type, row.quantity_litres)), D(0));
}

/** Book stock grouped by product for a station. */
export function stockByProduct(stationId: string) {
  const rows = all<{
    product_id: string;
    product_name: string;
    product_code: string;
    product_color: string;
    type: string;
    quantity_litres: string;
  }>(
    `SELECT p.id AS product_id, p.name AS product_name, p.code AS product_code, p.color AS product_color,
            m.type, m.quantity_litres
       FROM stock_movements m
       JOIN fuel_products p ON p.id = m.product_id
      WHERE m.station_id = ?`,
    [stationId],
  );
  const grouped = new Map<string, { productId: string; name: string; code: string; color: string; litres: Decimal }>();
  for (const row of rows) {
    const entry = grouped.get(row.product_id) ?? {
      productId: row.product_id,
      name: row.product_name,
      code: row.product_code,
      color: row.product_color,
      litres: D(0),
    };
    entry.litres = entry.litres.plus(signedLitres(row.type, row.quantity_litres));
    grouped.set(row.product_id, entry);
  }
  return [...grouped.values()].map((entry) => ({
    productId: entry.productId,
    name: entry.name,
    code: entry.code,
    color: entry.color,
    bookStockLitres: entry.litres.toFixed(3),
  }));
}

/** Latest dip measurement per tank, used by tank cards and variance alerts. */
export function latestMeasurement(tankId: string) {
  return get<{
    id: string;
    measured_litres: string;
    book_stock_litres: string;
    variance_litres: string;
    measured_at: string;
    method: string;
  }>(
    `SELECT id, measured_litres, book_stock_litres, variance_litres, measured_at, method
       FROM tank_measurements WHERE tank_id = ? ORDER BY measured_at DESC LIMIT 1`,
    [tankId],
  );
}

export function tankSummary(stationId: string) {
  const tanks = all<Record<string, unknown>>(
    `SELECT t.*, p.name AS product_name, p.code AS product_code, p.color AS product_color
       FROM tanks t JOIN fuel_products p ON p.id = t.product_id
      WHERE t.station_id = ? ORDER BY t.code`,
    [stationId],
  );
  return tanks.map((tank) => {
    const book = tankBookStock(String(tank.id));
    const capacity = D(tank.capacity_litres as string);
    const last = latestMeasurement(String(tank.id));
    return {
      id: String(tank.id),
      stationId: String(tank.station_id),
      code: String(tank.code),
      name: String(tank.name),
      productId: String(tank.product_id),
      productName: String(tank.product_name),
      productCode: String(tank.product_code),
      productColor: String(tank.product_color),
      capacityLitres: String(tank.capacity_litres),
      deadStockLitres: String(tank.dead_stock_litres),
      status: String(tank.status),
      calibrationReference: (tank.calibration_reference as string | null) ?? null,
      bookStockLitres: book.toFixed(3),
      fillPct: percent(book, capacity, 1),
      lastMeasuredLitres: last?.measured_litres ?? null,
      lastVarianceLitres: last?.variance_litres ?? null,
      lastMeasuredAt: last?.measured_at ?? null,
      lastMeasurementMethod: last?.method ?? null,
    };
  });
}

/**
 * Convert a dip reading (cm) to litres using the tank's calibration table.
 * Never guesses: without calibration points the conversion is rejected.
 */
export function convertDipToLitres(tankId: string, dipCm: string): Decimal {
  const points = all<{ dip_cm: string; litres: string }>(
    'SELECT dip_cm, litres FROM tank_calibration_points WHERE tank_id = ? ORDER BY CAST(dip_cm AS REAL) ASC',
    [tankId],
  );
  if (points.length < 2) {
    throw unprocessable('No calibration table is configured for this tank — record measured litres instead');
  }
  const dip = D(dipCm);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (dip.lt(D(first.dip_cm)) || dip.gt(D(last.dip_cm))) {
    throw unprocessable('Dip reading falls outside the calibrated range for this tank');
  }
  for (let i = 1; i < points.length; i += 1) {
    const low = points[i - 1]!;
    const high = points[i]!;
    const lowDip = D(low.dip_cm);
    const highDip = D(high.dip_cm);
    if (dip.gte(lowDip) && dip.lte(highDip)) {
      const span = highDip.minus(lowDip);
      if (span.isZero()) return D(low.litres);
      const ratio = dip.minus(lowDip).div(span);
      return D(low.litres).plus(D(high.litres).minus(D(low.litres)).mul(ratio));
    }
  }
  return D(last.litres);
}

export interface MovementInput {
  tenantId: string;
  stationId: string;
  tankId: string;
  productId: string;
  type: string;
  quantityLitres: string;
  occurredAt?: string;
  note?: string;
  referenceType?: string | null;
  referenceId?: string | null;
  createdBy?: string | null;
  isDemo?: boolean;
}

export function recordMovement(input: MovementInput) {
  const id = newId('mov');
  run(
    `INSERT INTO stock_movements
      (id, tenant_id, station_id, tank_id, product_id, type, quantity_litres, reference_type, reference_id,
       occurred_at, note, created_by, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.tenantId, input.stationId, input.tankId, input.productId, input.type, input.quantityLitres,
      input.referenceType ?? null, input.referenceId ?? null, input.occurredAt ?? nowIso(),
      input.note ?? null, input.createdBy ?? null, input.isDemo ? 1 : 0, nowIso()],
  );
  return id;
}

/** Tanks that hold a given product, used to allocate dispensed volume. */
export function tanksForProduct(stationId: string, productId: string) {
  return all<{ id: string; code: string }>(
    "SELECT id, code FROM tanks WHERE station_id = ? AND product_id = ? AND status = 'ACTIVE' ORDER BY code",
    [stationId, productId],
  );
}

/**
 * Split a dispensed (or reversed) volume across every active tank holding the
 * product. Pumps commonly run two tanks of the same grade, so posting the whole
 * volume to the first tank would overdraw it and leave the second untouched.
 * The split follows current book stock; with no stock on record it falls back to
 * an equal split. Rounding remainder is assigned to the last tank so the sum
 * always equals the requested litres.
 */
export function allocateAcrossTanks(stationId: string, productId: string, litres: Decimal) {
  const tanks = tanksForProduct(stationId, productId);
  if (tanks.length === 0) return [] as { tankId: string; litres: Decimal }[];
  if (tanks.length === 1) return [{ tankId: tanks[0]!.id, litres }];
  const stocks = tanks.map((tank) => ({
    tankId: tank.id,
    book: Math.max(0, Number(tankBookStock(tank.id))),
  }));
  const totalBook = stocks.reduce((sum, entry) => sum + entry.book, 0);
  let remaining = litres;
  return stocks.map((entry, index) => {
    const isLast = index === stocks.length - 1;
    const share = isLast
      ? remaining
      : totalBook > 0
        ? litres.mul(entry.book).div(totalBook)
        : litres.div(stocks.length);
    remaining = remaining.minus(share);
    return { tankId: entry.tankId, litres: share };
  });
}
