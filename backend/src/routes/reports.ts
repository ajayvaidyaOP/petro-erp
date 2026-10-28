import { Router } from 'express';
import { all, get, shape, shapeAll } from '../db/index.js';
import { asyncHandler, ok } from '../lib/http.js';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { accessibleStationIds, getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { addDays, istDayEnd, istDayStart, isIsoDate, todayIst } from '../lib/time.js';
import { D, Decimal, money } from '../lib/decimal.js';
import { tankSummary, signedLitres, tankBookStock } from '../lib/stock.js';
import { ACCOUNTING_DISCLAIMER, HARDWARE_DISCLAIMER, STOCK_VARIANCE_TOLERANCE_LITRES, STOCK_LOSS_NORM_PCT } from '@petroflow/shared';
import { complianceAlerts } from './compliance.js';
import { isDayClosed } from '../lib/dayclose.js';

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

function stationParam(req: { query: Record<string, unknown> }): string {
  const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
  if (!stationId) throw unprocessable('stationId is required');
  return stationId;
}

function dateParam(value: unknown): string {
  const date = typeof value === 'string' && value ? value : todayIst();
  if (!isIsoDate(date)) throw badRequest('Date must be in YYYY-MM-DD format');
  return date;
}

function totalByMode(stationId: string, start: string, end: string) {
  const rows = all<{ payment_mode: string; total: string }>(
    `SELECT payment_mode, COALESCE(SUM(CAST(amount AS REAL)), 0) AS total
       FROM fuel_transactions
      WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL
      GROUP BY payment_mode`,
    [stationId, start, end],
  );
  return Object.fromEntries(rows.map((r) => [r.payment_mode, money(r.total)]));
}

reportsRouter.get(
  '/owner-dashboard',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const stationId = stationParam(req);
    const station = getStationOrThrow(auth, stationId);
    const date = dateParam(req.query.date);
    const start = istDayStart(date);
    const end = istDayEnd(date);

    const sales = get<{ litres: string; value: string; count: number }>(
      `SELECT COALESCE(SUM(CAST(quantity_litres AS REAL)), 0) AS litres,
              COALESCE(SUM(CAST(amount AS REAL)), 0) AS value, COUNT(*) AS count
         FROM fuel_transactions
        WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL`,
      [station.id, start, end],
    );
    const shifts = all<Record<string, unknown>>(
      `SELECT s.*, u.name AS operator_name
         FROM shifts s LEFT JOIN users u ON u.id = s.operator_id
        WHERE s.station_id = ? AND s.business_date = ?
        ORDER BY s.shift_number`,
      [station.id, date],
    );
    const openShifts = all<Record<string, unknown>>(
      `SELECT s.*, u.name AS operator_name
         FROM shifts s LEFT JOIN users u ON u.id = s.operator_id
        WHERE s.station_id = ? AND s.status = 'OPEN' ORDER BY s.opened_at DESC`,
      [station.id],
    );
    const closedShifts = shifts.filter((s) => ['CLOSED', 'FLAGGED'].includes(String(s.status)));
    const shiftLitres = closedShifts.reduce((a, s) => a.plus(D(s.total_litres as string)), D(0));
    const shiftValue = closedShifts.reduce((a, s) => a.plus(D(s.total_value as string)), D(0));

    const productSplit = all<Record<string, unknown>>(
      `SELECT p.id, p.name, p.code, p.color,
              COALESCE(SUM(CASE WHEN s.status IN ('CLOSED','FLAGGED') THEN CAST(snr.litres_sold AS REAL) ELSE 0 END), 0) AS shift_litres,
              COALESCE(SUM(CASE WHEN s.status IN ('CLOSED','FLAGGED') THEN CAST(snr.sales_value AS REAL) ELSE 0 END), 0) AS shift_value
         FROM fuel_products p
         LEFT JOIN nozzles n ON n.product_id = p.id
         LEFT JOIN shift_nozzle_readings snr ON snr.nozzle_id = n.id
         LEFT JOIN shifts s ON s.id = snr.shift_id AND s.business_date = ? AND s.station_id = ?
        WHERE p.tenant_id = ?
        GROUP BY p.id, p.name, p.code, p.color
        ORDER BY p.code`,
      [date, station.id, station.tenant_id],
    );

    const devices = all<{ last_heartbeat_at: string | null; status: string }>(
      "SELECT last_heartbeat_at, status FROM hardware_devices WHERE station_id = ? AND status != 'DISABLED'",
      [station.id],
    );
    const online = devices.filter((d) => d.last_heartbeat_at && Date.now() - new Date(d.last_heartbeat_at).getTime() < 5 * 60_000).length;

    const receivables = D(
      get<{ total: string }>('SELECT COALESCE(SUM(CAST(balance AS REAL)), 0) AS total FROM customers WHERE tenant_id = ?', [station.tenant_id])?.total ?? 0,
    );
    const purchases = D(
      get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(total_amount AS REAL)), 0) AS total FROM deliveries
          WHERE tenant_id = ? AND status = 'RECEIVED'`,
        [station.tenant_id],
      )?.total ?? 0,
    );
    const payouts = D(
      get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM payments
          WHERE tenant_id = ? AND direction = 'PAYOUT' AND status != 'REVERSED'`,
        [station.tenant_id],
      )?.total ?? 0,
    );

    const trend: { date: string; litres: string; value: string; transactionsValue: string }[] = [];
    for (let i = 13; i >= 0; i -= 1) {
      const day = addDays(date, -i);
      const dayStart = istDayStart(day);
      const dayEnd = istDayEnd(day);
      const shiftRow = get<{ litres: string; value: string }>(
        `SELECT COALESCE(SUM(CAST(total_litres AS REAL)), 0) AS litres,
                COALESCE(SUM(CAST(total_value AS REAL)), 0) AS value
           FROM shifts WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED')`,
        [station.id, day],
      );
      const txRow = get<{ total: string }>(
        `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM fuel_transactions
          WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL`,
        [station.id, dayStart, dayEnd],
      );
      trend.push({
        date: day.slice(5),
        litres: D(shiftRow?.litres ?? 0).toFixed(3),
        value: money(shiftRow?.value ?? 0),
        transactionsValue: money(txRow?.total ?? 0),
      });
    }

    const alerts: { level: string; message: string }[] = [];
    const flagged = shifts.filter((s) => s.status === 'FLAGGED');
    if (flagged.length > 0) {
      alerts.push({ level: 'warning', message: `${flagged.length} shift(s) on ${date} are flagged and awaiting approval.` });
    }
    if (openShifts.length > 0) {
      alerts.push({ level: 'info', message: `${openShifts.length} shift(s) are currently open.` });
    }
    if (devices.length > 0 && online === 0) {
      alerts.push({ level: 'error', message: 'All hardware gateways are offline — readings will not arrive until they reconnect.' });
    } else if (devices.length > online) {
      alerts.push({ level: 'warning', message: `${devices.length - online} hardware gateway(s) are offline.` });
    }
    for (const tank of tankSummary(station.id)) {
      if (D(tank.bookStockLitres).lt(0)) {
        alerts.push({ level: 'error', message: `${tank.code}: negative book stock — review deliveries and dispensed entries.` });
      } else if (D(tank.capacityLitres).gt(0) && D(tank.fillPct).lt(15)) {
        alerts.push({ level: 'warning', message: `${tank.code}: low stock at ${tank.fillPct}% of capacity.` });
      }
    }
    alerts.push(...complianceAlerts(station.id));
    const yesterday = addDays(todayIst(), -1);
    if (!isDayClosed(station.id, yesterday)) {
      const hadShifts = get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM shifts WHERE station_id = ? AND business_date = ?',
        [station.id, yesterday],
      )?.count ?? 0;
      if (hadShifts > 0) {
        alerts.push({ level: 'warning', message: `Kal (${yesterday}) ka din band nahi hua hai — Shifts → Day closing se roznamcha band karo.` });
      }
    }

    const activity = all<Record<string, unknown>>(
      `SELECT action, summary, created_at, actor_email FROM audit_logs
        WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 8`,
      [station.tenant_id],
    );

    return ok(res, {
      station: { id: station.id, name: station.name, code: station.code },
      date,
      sales: {
        shiftLitres: shiftLitres.toFixed(3),
        shiftValue: money(shiftValue),
        shiftCount: closedShifts.length,
        transactionLitres: D(sales?.litres ?? 0).toFixed(3),
        transactionValue: money(sales?.value ?? 0),
        transactions: Number(sales?.count ?? 0),
        byMode: totalByMode(station.id, start, end),
      },
      shifts: shapeAll(shifts),
      openShifts: shapeAll(openShifts),
      flaggedShifts: flagged.length,
      stock: tankSummary(station.id),
      productSplit: shapeAll(productSplit),
      devices: { total: devices.length, online },
      receivables: money(receivables),
      payables: money(purchases.minus(payouts)),
      trend,
      alerts,
      recentActivity: shapeAll(activity),
      disclaimer: `${ACCOUNTING_DISCLAIMER} ${HARDWARE_DISCLAIMER}`,
    });
  }),
);

reportsRouter.get(
  '/station-summary',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const date = dateParam(req.query.date);
    const start = istDayStart(date);
    const end = istDayEnd(date);
    const allowed = new Set(accessibleStationIds(auth));

    const stations = all<Record<string, unknown>>(
      `SELECT id, code, name, status FROM stations WHERE tenant_id = ? ORDER BY name`,
      [tenantId],
    ).filter((station) => allowed.has(String(station.id)));

    const rows = stations.map((station) => {
      const stationId = String(station.id);
      const shift = get<{ litres: string; value: string; count: number; open_count: number }>(
        `SELECT COALESCE(SUM(CASE WHEN status IN ('CLOSED','FLAGGED') THEN CAST(total_litres AS REAL) ELSE 0 END), 0) AS litres,
                COALESCE(SUM(CASE WHEN status IN ('CLOSED','FLAGGED') THEN CAST(total_value AS REAL) ELSE 0 END), 0) AS value,
                COALESCE(SUM(CASE WHEN status IN ('CLOSED','FLAGGED') THEN 1 ELSE 0 END), 0) AS count,
                COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open_count
           FROM shifts WHERE station_id = ? AND business_date = ?`,
        [stationId, date],
      );
      const tx = get<{ litres: string; value: string; count: number }>(
        `SELECT COALESCE(SUM(CAST(quantity_litres AS REAL)), 0) AS litres,
                COALESCE(SUM(CAST(amount AS REAL)), 0) AS value,
                COUNT(*) AS count
           FROM fuel_transactions
          WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL`,
        [stationId, start, end],
      );
      const lowStock = tankSummary(stationId).filter(
        (tank) => D(tank.capacityLitres).gt(0) && D(tank.fillPct).lt(15),
      ).length;
      const devices = all<{ last_heartbeat_at: string | null }>(
        "SELECT last_heartbeat_at FROM hardware_devices WHERE station_id = ? AND status != 'DISABLED'",
        [stationId],
      );
      const online = devices.filter(
        (d) => d.last_heartbeat_at && Date.now() - new Date(d.last_heartbeat_at).getTime() < 5 * 60_000,
      ).length;
      const flagged = get<{ count: number }>(
        "SELECT COUNT(*) AS count FROM shifts WHERE station_id = ? AND business_date = ? AND status = 'FLAGGED'",
        [stationId, date],
      )?.count ?? 0;
      return {
        id: stationId,
        code: station.code,
        name: station.name,
        status: station.status,
        shiftLitres: D(shift?.litres ?? 0).toFixed(3),
        shiftValue: money(shift?.value ?? 0),
        closedShifts: Number(shift?.count ?? 0),
        openShifts: Number(shift?.open_count ?? 0),
        flaggedShifts: Number(flagged),
        transactionLitres: D(tx?.litres ?? 0).toFixed(3),
        transactionValue: money(tx?.value ?? 0),
        transactions: Number(tx?.count ?? 0),
        lowStockTanks: lowStock,
        devicesTotal: devices.length,
        devicesOnline: online,
      };
    });

    return ok(res, { date, stations: rows });
  }),
);

reportsRouter.get(
  '/sales-trend',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const stationId = stationParam(req);
    const station = getStationOrThrow(auth, stationId);
    const days = Math.min(90, Math.max(7, Number(req.query.days ?? 30)));
    const points: Record<string, string>[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = addDays(todayIst(), -i);
      const row = get<{ litres: string; value: string }>(
        `SELECT COALESCE(SUM(CAST(total_litres AS REAL)), 0) AS litres,
                COALESCE(SUM(CAST(total_value AS REAL)), 0) AS value
           FROM shifts WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED')`,
        [station.id, day],
      );
      points.push({ date: day, litres: D(row?.litres ?? 0).toFixed(3), value: money(row?.value ?? 0) });
    }
    return ok(res, { stationId: station.id, days, points });
  }),
);

reportsRouter.get(
  '/dsr',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const stationId = stationParam(req);
    const station = getStationOrThrow(auth, stationId);
    const date = dateParam(req.query.date);
    const start = istDayStart(date);
    const end = istDayEnd(date);

    const nozzleSales = all<Record<string, unknown>>(
      `SELECT snr.id, s.shift_number, s.status AS shift_status, s.business_date,
              n.label AS nozzle_label, n.number AS nozzle_number, d.code AS dispenser_code,
              p.name AS product_name, p.code AS product_code,
              snr.opening_reading, snr.closing_reading, snr.opening_source, snr.closing_source,
              snr.litres_sold, snr.rate, snr.sales_value, snr.variance_litres, snr.status
         FROM shift_nozzle_readings snr
         JOIN shifts s ON s.id = snr.shift_id
         JOIN nozzles n ON n.id = snr.nozzle_id
         JOIN dispensers d ON d.id = n.dispenser_id
         JOIN fuel_products p ON p.id = n.product_id
        WHERE s.station_id = ? AND s.business_date = ? AND s.status != 'REVERSED'
        ORDER BY s.shift_number, d.code, n.number`,
      [station.id, date],
    );

    const productTotals = all<{ product: string; code: string; litres: string; value: string }>(
      `SELECT p.name AS product, p.code AS code,
              COALESCE(SUM(CAST(snr.litres_sold AS REAL)), 0) AS litres,
              COALESCE(SUM(CAST(snr.sales_value AS REAL)), 0) AS value
         FROM shift_nozzle_readings snr
         JOIN shifts s ON s.id = snr.shift_id
         JOIN nozzles n ON n.id = snr.nozzle_id
         JOIN fuel_products p ON p.id = n.product_id
        WHERE s.station_id = ? AND s.business_date = ? AND s.status IN ('CLOSED','FLAGGED')
        GROUP BY p.id, p.name, p.code ORDER BY p.code`,
      [station.id, date],
    );

    const shifts = all<Record<string, unknown>>(
      `SELECT s.*, u.name AS operator_name
         FROM shifts s LEFT JOIN users u ON u.id = s.operator_id
        WHERE s.station_id = ? AND s.business_date = ? ORDER BY s.shift_number`,
      [station.id, date],
    );
    const transactions = all<Record<string, unknown>>(
      `SELECT t.*, n.label AS nozzle_label, p.name AS product_name
         FROM fuel_transactions t
         LEFT JOIN nozzles n ON n.id = t.nozzle_id
         JOIN fuel_products p ON p.id = t.product_id
        WHERE t.station_id = ? AND t.occurred_at >= ? AND t.occurred_at <= ? AND t.voided_at IS NULL
        ORDER BY t.occurred_at`,
      [station.id, start, end],
    );
    const expenses = all<Record<string, unknown>>(
      `SELECT * FROM expenses WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at`,
      [station.id, start, end],
    );
    const deliveries = all<Record<string, unknown>>(
      `SELECT d.*, s.name AS supplier_name, p.name AS product_name
         FROM deliveries d JOIN suppliers s ON s.id = d.supplier_id JOIN fuel_products p ON p.id = d.product_id
        WHERE d.station_id = ? AND d.invoice_date = ? AND d.status = 'RECEIVED' ORDER BY d.created_at`,
      [station.id, date],
    );
    const receipts = all<Record<string, unknown>>(
      `SELECT p.*, c.name AS customer_name FROM payments p LEFT JOIN customers c ON c.id = p.customer_id
        WHERE p.station_id = ? AND p.direction = 'RECEIPT' AND p.status != 'REVERSED'
          AND p.occurred_at >= ? AND p.occurred_at <= ? ORDER BY p.occurred_at`,
      [station.id, start, end],
    );

    const aggregateLitres = shifts
      .filter((s) => ['CLOSED', 'FLAGGED'].includes(String(s.status)))
      .reduce((a, s) => a.plus(D(s.total_litres as string)), D(0));
    const aggregateValue = shifts
      .filter((s) => ['CLOSED', 'FLAGGED'].includes(String(s.status)))
      .reduce((a, s) => a.plus(D(s.total_value as string)), D(0));
    const transactionLitres = transactions.reduce((a, t) => a.plus(D(t.quantity_litres as string)), D(0));
    const transactionValue = transactions.reduce((a, t) => a.plus(D(t.amount as string)), D(0));
    const expenseTotal = expenses.reduce((a, e) => a.plus(D(e.amount as string)), D(0));
    const receiptTotal = receipts.reduce((a, r) => a.plus(D(r.amount as string)), D(0));
    const purchaseTotal = deliveries.reduce((a, d) => a.plus(D(d.total_amount as string)), D(0));

    const stock = all<Record<string, unknown>>(
      `SELECT t.id, t.code, t.name, p.name AS product_name, t.capacity_litres
         FROM tanks t JOIN fuel_products p ON p.id = t.product_id
        WHERE t.station_id = ? ORDER BY t.code`,
      [station.id],
    ).map((tank) => {
      const movements = all<{ type: string; quantity_litres: string; occurred_at: string }>(
        'SELECT type, quantity_litres, occurred_at FROM stock_movements WHERE tank_id = ?',
        [String(tank.id)],
      );
      let openingBook = D(0);
      let deliveredToday = D(0);
      let dispensedToday = D(0);
      let closing = D(0);
      for (const movement of movements) {
        const signed = signedLitres(movement.type, movement.quantity_litres);
        closing = closing.plus(signed);
        if (movement.occurred_at < start) openingBook = openingBook.plus(signed);
        else if (movement.occurred_at <= end) {
          if (movement.type === 'DELIVERY' || movement.type === 'TRANSFER_IN') deliveredToday = deliveredToday.plus(signed.abs());
          if (movement.type === 'DISPENSED') dispensedToday = dispensedToday.plus(signed.abs());
        }
      }
      const measurement = get<{ measured_litres: string; measured_at: string }>(
        'SELECT measured_litres, measured_at FROM tank_measurements WHERE tank_id = ? ORDER BY measured_at DESC LIMIT 1',
        [String(tank.id)],
      );
      return {
        id: tank.id,
        code: tank.code,
        name: tank.name,
        productName: tank.product_name,
        capacityLitres: tank.capacity_litres,
        openingBook: openingBook.toFixed(3),
        deliveredToday: deliveredToday.toFixed(3),
        dispensedBook: dispensedToday.toFixed(3),
        bookClosing: closing.toFixed(3),
        measured: measurement?.measured_litres ?? null,
        measuredAt: measurement?.measured_at ?? null,
        varianceFlag: measurement
          ? D(measurement.measured_litres).minus(closing).abs().gt(STOCK_VARIANCE_TOLERANCE_LITRES)
          : false,
      };
    });

    const reconciliation = get<Record<string, unknown>>(
      `SELECT * FROM reconciliations WHERE station_id = ? AND business_date = ? ORDER BY created_at DESC LIMIT 1`,
      [station.id, date],
    );

    const paymentMix = totalByMode(station.id, start, end);
    const flaggedShifts = shifts.filter((s) => s.status === 'FLAGGED').length;

    return ok(res, {
      station: {
        name: station.name,
        code: station.code,
        address: (station.address as string | null) ?? null,
        city: (station.city as string | null) ?? null,
        state: (station.state as string | null) ?? null,
      },
      date,
      generatedAt: new Date().toISOString(),
      nozzleSales: shapeAll(nozzleSales),
      productTotals: productTotals.map((row) => ({ ...row, value: money(row.value) })),
      shifts: shapeAll(shifts),
      transactions: shapeAll(transactions),
      paymentMix,
      totals: {
        aggregateLitres: aggregateLitres.toFixed(3),
        aggregateEstimatedValue: money(aggregateValue),
        transactionLitres: transactionLitres.toFixed(3),
        transactionValue: money(transactionValue),
        expenses: money(expenseTotal),
        receipts: money(receiptTotal),
        purchases: money(purchaseTotal),
      },
      expenses: shapeAll(expenses),
      deliveries: shapeAll(deliveries),
      receipts: shapeAll(receipts),
      stock,
      reconciliation: reconciliation
        ? {
            ...shape(reconciliation),
            variance: money(D(reconciliation.variance as string)),
          }
        : null,
      notes: [
        `Nozzle sales are derived as closing totalizer − opening totalizer for each nozzle. ${HARDWARE_DISCLAIMER}`,
        'Aggregate shift values are estimates computed from totalizer litres and the price effective at shift close; they do not represent audited revenue.',
        'Stock closing is a book figure (opening + received − dispensed ± adjustments). Physical dips are recorded separately and are not substituted for book stock.',
        'Credit sales and customer receipts are recorded in the credit ledger and are not counted as cash until a receipt is recorded.',
        flaggedShifts > 0 ? `${flaggedShifts} flagged shift(s) on this date require owner/manager approval.` : 'All shifts on this date are approved or closed without variances.',
        `Tank stocks below are shown in litres. Aggregate dispensed volume is spread across every active tank holding that grade in proportion to book stock, because totalizer capture is per nozzle, not per tank.`,
        ACCOUNTING_DISCLAIMER,
      ],
    });
  }),
);

// ------------------------------------------------------- stock loss/gain
function monthRange(month: string) {
  const start = `${month}-01`;
  const next = addDays(`${month}-28`, 4).slice(0, 8) + '01';
  return { fromIso: istDayStart(start), toIso: istDayStart(next), start, next };
}

function monthParam(req: { query: Record<string, unknown> }): string {
  const month = typeof req.query.month === 'string' ? req.query.month : todayIst().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('month must be YYYY-MM');
  return month;
}

function stockLossRows(stationId: string, month: string) {
  const { fromIso, toIso } = monthRange(month);
  const products = all<{ id: string; name: string; code: string; category: string; color: string }>(
    `SELECT DISTINCT p.id, p.name, p.code, p.category, p.color
       FROM fuel_products p JOIN tanks t ON t.product_id = p.id
      WHERE t.station_id = ? ORDER BY p.code`,
    [stationId],
  );
  const movements = all<{ product_id: string; type: string; quantity_litres: string; occurred_at: string }>(
    'SELECT product_id, type, quantity_litres, occurred_at FROM stock_movements WHERE station_id = ? AND occurred_at < ?',
    [stationId, toIso],
  );
  const tanks = all<{ id: string; product_id: string; code: string }>(
    'SELECT id, product_id, code FROM tanks WHERE station_id = ?',
    [stationId],
  );
  const dips = all<{ tank_id: string; measured_litres: string; measured_at: string }>(
    `SELECT tank_id, measured_litres, measured_at FROM tank_measurements
      WHERE station_id = ? AND measured_at >= ? AND measured_at < ? ORDER BY measured_at ASC`,
    [stationId, fromIso, toIso],
  );

  return products.map((product) => {
    let opening = D(0); let receipts = D(0); let dispensed = D(0); let adjustments = D(0); let closingBook = D(0);
    for (const movement of movements) {
      if (movement.product_id !== product.id) continue;
      const signed = signedLitres(movement.type, movement.quantity_litres);
      closingBook = closingBook.plus(signed);
      if (movement.occurred_at < fromIso) { opening = opening.plus(signed); continue; }
      if (movement.type === 'DELIVERY' || movement.type === 'TRANSFER_IN') receipts = receipts.plus(signed.abs());
      else if (movement.type === 'DISPENSED') dispensed = dispensed.plus(signed.abs());
      else if (movement.type === 'ADJUSTMENT') adjustments = adjustments.plus(signed);
    }
    // Physical stock: mahine ki aakhri dip per tank. Ek bhi tank ki dip na ho to statement adhuri.
    const productTanks = tanks.filter((t) => t.product_id === product.id);
    let physicalSum = D(0);
    let dipMissing = false;
    for (const tank of productTanks) {
      const tankDips = dips.filter((d) => d.tank_id === tank.id);
      if (tankDips.length === 0) { dipMissing = true; break; }
      physicalSum = physicalSum.plus(D(tankDips[tankDips.length - 1]!.measured_litres));
    }
    const physical: Decimal | null = dipMissing || productTanks.length === 0 ? null : physicalSum;
    const lossGain = physical !== null ? physical.minus(closingBook) : null;
    const lossPct = lossGain !== null && dispensed.gt(0) ? lossGain.div(dispensed).mul(100) : null;
    const normPct = STOCK_LOSS_NORM_PCT[product.category] ?? 0;
    let status = 'NO_DIP';
    if (lossGain !== null && lossPct !== null) {
      if (lossPct.lt(-normPct)) status = 'BEYOND_NORM';
      else if (lossPct.gt(normPct)) status = 'GAIN_CHECK';
      else status = 'WITHIN_NORM';
    } else if (lossGain !== null) status = 'WITHIN_NORM';
    return {
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      category: product.category,
      color: product.color,
      openingLitres: opening.toFixed(3),
      receiptsLitres: receipts.toFixed(3),
      dispensedLitres: dispensed.toFixed(3),
      adjustmentsLitres: adjustments.toFixed(3),
      closingBookLitres: closingBook.toFixed(3),
      physicalLitres: physical !== null ? physical.toFixed(3) : null,
      lossGainLitres: lossGain !== null ? lossGain.toFixed(3) : null,
      lossGainPctOfSales: lossPct !== null ? lossPct.toFixed(3) : null,
      normPct: String(normPct),
      status,
    };
  });
}

reportsRouter.get(
  '/stock-loss',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const station = getStationOrThrow(auth, stationParam(req));
    const month = monthParam(req);
    return ok(res, {
      station: { id: station.id, name: station.name, code: station.code },
      month,
      rows: stockLossRows(station.id, month),
      note: 'Loss/gain = aakhri dip (physical) − book stock. Norm % OMC guidance hai (petrol 0.75%, diesel 0.25% sales par); isse zyada loss par jaanch zaroori hai.',
      toleranceLitres: STOCK_VARIANCE_TOLERANCE_LITRES,
    });
  }),
);

// ------------------------------------------------------------ indent plan
reportsRouter.get(
  '/indent',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const station = getStationOrThrow(auth, stationParam(req));
    const since = istDayStart(addDays(todayIst(), -14));
    const rows = tankSummary(station.id).map((tank) => {
      const movements = all<{ quantity_litres: string }>(
        "SELECT quantity_litres FROM stock_movements WHERE tank_id = ? AND type = 'DISPENSED' AND occurred_at >= ?",
        [tank.id, since],
      );
      const dispensed14 = movements.reduce((acc, m) => acc.plus(D(m.quantity_litres).abs()), D(0));
      const daily = dispensed14.div(14);
      const book = D(tank.bookStockLitres);
      const usable = book.minus(D(tank.deadStockLitres));
      const capacity = D(tank.capacityLitres);
      const daysCover = daily.gt(0) ? usable.div(daily) : null;
      let suggestion = D(0);
      let priority = 'OK';
      if (daysCover !== null && daysCover.lt(4)) {
        priority = daysCover.lt(2) ? 'HIGH' : 'MEDIUM';
        const target = capacity.mul(0.9).minus(book);
        const ullage = capacity.minus(book);
        const raw = target.lt(ullage) ? target : ullage;
        suggestion = raw.gt(0) ? raw.div(500).floor().mul(500) : D(0);
      } else if (D(tank.fillPct).lt(20)) {
        priority = 'MEDIUM';
      }
      return {
        tankId: tank.id,
        tankCode: tank.code,
        productName: tank.productName,
        productColor: tank.productColor,
        bookStockLitres: tank.bookStockLitres,
        capacityLitres: tank.capacityLitres,
        fillPct: tank.fillPct,
        ullageLitres: capacity.minus(book).toFixed(3),
        avgDailySalesLitres: daily.toFixed(1),
        daysOfCover: daysCover !== null ? daysCover.toFixed(1) : null,
        suggestedOrderLitres: suggestion.toFixed(0),
        priority,
      };
    });
    return ok(res, {
      station: { id: station.id, name: station.name, code: station.code },
      basedOnDays: 14,
      rows,
      note: 'Days of cover = (book − dead stock) ÷ pichhle 14 din ki average bikri. 4 din se kam bache to indent ka sujhau (500 L ke round figure me, tank 90% tak).',
    });
  }),
);

// ------------------------------------------------------------ credit ageing
function ageingRows(tenantId: string) {
  const customers = all<{ id: string; code: string; name: string; phone: string | null; credit_limit: string }>(
    "SELECT id, code, name, phone, credit_limit FROM customers WHERE tenant_id = ? AND status = 'ACTIVE' ORDER BY name",
    [tenantId],
  );
  const todayMs = new Date(`${todayIst()}T12:00:00+05:30`).getTime();
  const result: Record<string, unknown>[] = [];
  for (const customer of customers) {
    const sales = all<{ amount: string; occurred_at: string }>(
      "SELECT amount, occurred_at FROM credit_entries WHERE customer_id = ? AND type = 'CREDIT_SALE' AND status = 'POSTED' ORDER BY occurred_at ASC, created_at ASC",
      [customer.id],
    );
    if (sales.length === 0) continue;
    let paidPool = all<{ amount: string }>(
      "SELECT amount FROM credit_entries WHERE customer_id = ? AND type = 'PAYMENT' AND status = 'POSTED'",
      [customer.id],
    ).reduce((acc, row) => acc.plus(D(row.amount)), D(0));
    // FIFO: sabse purani udhaar pehle bhari gayi maano.
    const buckets = { d0_30: D(0), d31_60: D(0), d61_90: D(0), d90plus: D(0) };
    let outstanding = D(0);
    let oldestUnpaidAt: string | null = null;
    for (const sale of sales) {
      let remaining = D(sale.amount);
      if (paidPool.gt(0)) {
        const used = remaining.lt(paidPool) ? remaining : paidPool;
        remaining = remaining.minus(used);
        paidPool = paidPool.minus(used);
      }
      if (remaining.lte(0)) continue;
      outstanding = outstanding.plus(remaining);
      if (!oldestUnpaidAt) oldestUnpaidAt = sale.occurred_at;
      const ageDays = Math.floor((todayMs - new Date(sale.occurred_at).getTime()) / 86_400_000);
      if (ageDays <= 30) buckets.d0_30 = buckets.d0_30.plus(remaining);
      else if (ageDays <= 60) buckets.d31_60 = buckets.d31_60.plus(remaining);
      else if (ageDays <= 90) buckets.d61_90 = buckets.d61_90.plus(remaining);
      else buckets.d90plus = buckets.d90plus.plus(remaining);
    }
    if (outstanding.lte(0)) continue;
    result.push({
      customerId: customer.id,
      code: customer.code,
      name: customer.name,
      phone: customer.phone,
      creditLimit: customer.credit_limit,
      outstanding: money(outstanding),
      bucket0To30: money(buckets.d0_30),
      bucket31To60: money(buckets.d31_60),
      bucket61To90: money(buckets.d61_90),
      bucket90Plus: money(buckets.d90plus),
      oldestUnpaidAt,
      overLimit: D(customer.credit_limit).gt(0) && outstanding.gt(D(customer.credit_limit)),
    });
  }
  return result;
}

reportsRouter.get(
  '/ageing',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const rows = ageingRows(tenantIdOf(auth)).sort((a, b) => Number(b.bucket90Plus) - Number(a.bucket90Plus) || Number(b.outstanding) - Number(a.outstanding));
    const totals: Record<'outstanding' | 'bucket0To30' | 'bucket31To60' | 'bucket61To90' | 'bucket90Plus', Decimal> = {
      outstanding: D(0), bucket0To30: D(0), bucket31To60: D(0), bucket61To90: D(0), bucket90Plus: D(0),
    };
    for (const row of rows) {
      totals.outstanding = totals.outstanding.plus(D(String(row.outstanding)));
      totals.bucket0To30 = totals.bucket0To30.plus(D(String(row.bucket0To30)));
      totals.bucket31To60 = totals.bucket31To60.plus(D(String(row.bucket31To60)));
      totals.bucket61To90 = totals.bucket61To90.plus(D(String(row.bucket61To90)));
      totals.bucket90Plus = totals.bucket90Plus.plus(D(String(row.bucket90Plus)));
    }
    return ok(res, {
      asOf: todayIst(),
      rows,
      totals: {
        outstanding: money(totals.outstanding), bucket0To30: money(totals.bucket0To30),
        bucket31To60: money(totals.bucket31To60), bucket61To90: money(totals.bucket61To90),
        bucket90Plus: money(totals.bucket90Plus),
      },
      note: 'Payments FIFO tareeke se sabse purani udhaar me lage mane gaye hain.',
    });
  }),
);

// ---------------------------------------------------------------- exports
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res: { setHeader: (k: string, v: string) => void; send: (b: string) => unknown }, filename: string, header: string[], rows: unknown[][]) {
  const body = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(body);
}

reportsRouter.get(
  '/export/sales-register.csv',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const station = getStationOrThrow(auth, stationParam(req));
    const month = monthParam(req);
    const { fromIso, toIso } = monthRange(month);
    const rows = all<Record<string, unknown>>(
      `SELECT ft.occurred_at, p.name AS product_name, p.code AS product_code, n.label AS nozzle_label,
              s.shift_number, ft.quantity_litres, ft.rate, ft.amount, ft.payment_mode,
              c.name AS customer_name, ft.reference, ft.source
         FROM fuel_transactions ft
         JOIN fuel_products p ON p.id = ft.product_id
         LEFT JOIN nozzles n ON n.id = ft.nozzle_id
         LEFT JOIN shifts s ON s.id = ft.shift_id
         LEFT JOIN customers c ON c.id = ft.customer_id
        WHERE ft.station_id = ? AND ft.occurred_at >= ? AND ft.occurred_at < ? AND ft.voided_at IS NULL
        ORDER BY ft.occurred_at ASC`,
      [station.id, fromIso, toIso],
    );
    return sendCsv(res as never, `sales-register-${station.code}-${month}.csv`,
      ['DateTime (UTC)', 'Product', 'Code', 'Nozzle', 'Shift', 'Litres', 'Rate', 'Amount (INR)', 'Payment Mode', 'Customer', 'Reference', 'Source'],
      rows.map((r) => [r.occurred_at, r.product_name, r.product_code, r.nozzle_label, r.shift_number, r.quantity_litres, r.rate, r.amount, r.payment_mode, r.customer_name, r.reference, r.source]),
    );
  }),
);

reportsRouter.get(
  '/export/stock-statement.csv',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const station = getStationOrThrow(auth, stationParam(req));
    const month = monthParam(req);
    const rows = stockLossRows(station.id, month);
    return sendCsv(res as never, `stock-statement-${station.code}-${month}.csv`,
      ['Product', 'Code', 'Opening (L)', 'Receipts (L)', 'Sales (L)', 'Adjustments (L)', 'Closing Book (L)', 'Physical Dip (L)', 'Loss/Gain (L)', 'Loss/Gain % of Sales', 'Norm %', 'Status'],
      rows.map((r) => [r.productName, r.productCode, r.openingLitres, r.receiptsLitres, r.dispensedLitres, r.adjustmentsLitres, r.closingBookLitres, r.physicalLitres, r.lossGainLitres, r.lossGainPctOfSales, r.normPct, r.status]),
    );
  }),
);

reportsRouter.get(
  '/export/ageing.csv',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const rows = ageingRows(tenantIdOf(auth));
    return sendCsv(res as never, `credit-ageing-${todayIst()}.csv`,
      ['Customer Code', 'Customer', 'Phone', 'Credit Limit', 'Outstanding', '0-30 din', '31-60 din', '61-90 din', '90+ din', 'Sabse Purani Udhaar'],
      rows.map((r) => [r.code, r.name, r.phone, r.creditLimit, r.outstanding, r.bucket0To30, r.bucket31To60, r.bucket61To90, r.bucket90Plus, r.oldestUnpaidAt]),
    );
  }),
);

reportsRouter.get(
  '/export/lubricants-gst.csv',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const station = getStationOrThrow(auth, stationParam(req));
    const month = monthParam(req);
    const { fromIso, toIso } = monthRange(month);
    const rows = all<Record<string, unknown>>(
      `SELECT m.occurred_at, p.name AS product_name, p.pack_size, p.hsn_code, p.gst_rate_pct,
              m.quantity, m.rate, m.amount, m.payment_mode, c.name AS customer_name, c.gstin AS customer_gstin, m.vehicle_number
         FROM lube_movements m
         JOIN lube_products p ON p.id = m.product_id
         LEFT JOIN customers c ON c.id = m.customer_id
        WHERE m.station_id = ? AND m.type = 'SALE' AND m.occurred_at >= ? AND m.occurred_at < ?
        ORDER BY m.occurred_at ASC`,
      [station.id, fromIso, toIso],
    );
    return sendCsv(res as never, `lubricants-gst-${station.code}-${month}.csv`,
      ['DateTime (UTC)', 'Item', 'Pack', 'HSN', 'Qty (pack)', 'Rate (incl GST)', 'Amount (incl GST)', 'GST %', 'Taxable Value', 'GST Amount', 'Payment Mode', 'Customer', 'Customer GSTIN', 'Vehicle'],
      rows.map((r) => {
        const amount = D(String(r.amount));
        const gstPct = D(String(r.gst_rate_pct ?? 18));
        const taxable = amount.mul(100).div(gstPct.plus(100));
        return [r.occurred_at, r.product_name, r.pack_size, r.hsn_code, D(String(r.quantity)).abs().toFixed(2), r.rate, r.amount, r.gst_rate_pct, money(taxable), money(amount.minus(taxable)), r.payment_mode, r.customer_name, r.customer_gstin, r.vehicle_number];
      }),
    );
  }),
);

reportsRouter.get(
  '/meta',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reports.read')) throw forbidden();
    const tenantId = tenantIdOf(auth);
    const subscription = get<Record<string, unknown>>(
      `SELECT s.ends_at, s.trial_ends_at, s.status, p.name AS plan_name, p.max_stations, p.max_users, p.max_dispensers
         FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
      [tenantId],
    );
    return ok(res, {
      tenantId,
      subscription: shape(subscription),
      limits: {
        maxJumpLitres: Number(get<{ value: string }>("SELECT value FROM app_settings WHERE tenant_id = ? AND key = 'hardware.maxJumpLitres'", [tenantId])?.value ?? 10000),
      },
      disclaimers: { accounting: ACCOUNTING_DISCLAIMER, hardware: HARDWARE_DISCLAIMER },
    });
  }),
);
