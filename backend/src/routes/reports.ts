import { Router } from 'express';
import { all, get, shape, shapeAll } from '../db/index.js';
import { asyncHandler, ok } from '../lib/http.js';
import { badRequest, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { accessibleStationIds, getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { addDays, istDayEnd, istDayStart, isIsoDate, todayIst } from '../lib/time.js';
import { D, money } from '../lib/decimal.js';
import { tankSummary, signedLitres, tankBookStock } from '../lib/stock.js';
import { ACCOUNTING_DISCLAIMER, HARDWARE_DISCLAIMER, STOCK_VARIANCE_TOLERANCE_LITRES } from '@petroflow/shared';

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
