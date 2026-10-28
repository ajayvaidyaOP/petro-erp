import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, created, ok, pageMeta, paging, sortClause } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso, businessDateOf } from '../lib/time.js';
import { evaluateDensity } from '../lib/density.js';
import { assertDayOpen } from '../lib/dayclose.js';
import { D, money, rate as fmtRate } from '../lib/decimal.js';
import { recordMovement, signedLitres, stockByProduct, tankBookStock, tankSummary } from '../lib/stock.js';
import { STOCK_VARIANCE_TOLERANCE_LITRES } from '@petroflow/shared';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

function tankInTenant(auth: AuthContext, tankId: string) {
  const tank = get<Record<string, unknown>>(
    'SELECT t.*, s.tenant_id, s.id AS station_id FROM tanks t JOIN stations s ON s.id = t.station_id WHERE t.id = ?',
    [tankId],
  );
  if (!tank || tank.tenant_id !== tenantIdOf(auth)) throw notFound('Tank not found');
  getStationOrThrow(auth, String(tank.station_id));
  return tank;
}

// ----------------------------------------------------------------- overview

inventoryRouter.get(
  '/stock',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const tanks = tankSummary(station.id);
    const products = stockByProduct(station.id);
    const warnings: { level: string; message: string; tankId?: string }[] = [];
    for (const tank of tanks) {
      const book = D(tank.bookStockLitres);
      const capacity = D(tank.capacityLitres);
      if (book.lt(0)) {
        warnings.push({ level: 'error', tankId: tank.id, message: `${tank.code}: book stock is negative (${tank.bookStockLitres} L) — check deliveries and dispensed entries` });
      }
      if (capacity.gt(0) && book.div(capacity).lt(0.15)) {
        warnings.push({ level: 'warning', tankId: tank.id, message: `${tank.code}: low stock (${tank.fillPct}% of capacity)` });
      }
      if (book.gt(capacity)) {
        warnings.push({ level: 'error', tankId: tank.id, message: `${tank.code}: book stock exceeds tank capacity (${tank.bookStockLitres} L vs ${tank.capacityLitres} L)` });
      }
      if (tank.lastVarianceLitres && D(tank.lastVarianceLitres).abs().gt(STOCK_VARIANCE_TOLERANCE_LITRES)) {
        warnings.push({ level: 'warning', tankId: tank.id, message: `${tank.code}: last dip variance ${tank.lastVarianceLitres} L exceeds tolerance` });
      }
    }
    const recent = all(
      `SELECT m.*, t.code AS tank_code, p.name AS product_name
         FROM stock_movements m JOIN tanks t ON t.id = m.tank_id JOIN fuel_products p ON p.id = m.product_id
        WHERE m.station_id = ? ORDER BY m.occurred_at DESC LIMIT 25`,
      [station.id],
    );
    return ok(res, {
      station: { id: station.id, name: station.name, code: station.code },
      tanks,
      products,
      warnings,
      recentMovements: shapeAll(recent),
    });
  }),
);

inventoryRouter.get(
  '/movements',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['m.tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) {
      getStationOrThrow(auth, stationId);
      clauses.push('m.station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`m.station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
      params.push(...ids);
    }
    for (const [key, column] of [['tankId', 'm.tank_id'], ['type', 'm.type'], ['productId', 'm.product_id']] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value) { clauses.push(`${column} = ?`); params.push(value); }
    }
    if (typeof req.query.from === 'string' && req.query.from) { clauses.push('m.occurred_at >= ?'); params.push(req.query.from); }
    if (typeof req.query.to === 'string' && req.query.to) { clauses.push('m.occurred_at <= ?'); params.push(req.query.to); }
    const where = clauses.join(' AND ');
    const order = sortClause(req.query as Record<string, unknown>, { occurredAt: 'm.occurred_at', quantity: 'CAST(m.quantity_litres AS REAL)' }, 'm.occurred_at DESC');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM stock_movements m WHERE ${where}`, params)?.count ?? 0;
    const rows = all(
      `SELECT m.*, t.code AS tank_code, t.name AS tank_name, p.name AS product_name, p.code AS product_code
         FROM stock_movements m JOIN tanks t ON t.id = m.tank_id JOIN fuel_products p ON p.id = m.product_id
        WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

// --------------------------------------------------------------- deliveries

inventoryRouter.get(
  '/deliveries',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'deliveries.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['d.tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) {
      getStationOrThrow(auth, stationId);
      clauses.push('d.station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`d.station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
      params.push(...ids);
    }
    if (typeof req.query.status === 'string' && req.query.status) {
      clauses.push('d.status = ?');
      params.push(req.query.status);
    }
    if (typeof req.query.from === 'string' && req.query.from) { clauses.push('d.invoice_date >= ?'); params.push(req.query.from); }
    if (typeof req.query.to === 'string' && req.query.to) { clauses.push('d.invoice_date <= ?'); params.push(req.query.to); }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      clauses.push('(d.invoice_number LIKE ? OR s.name LIKE ? OR d.vehicle_number LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const where = clauses.join(' AND ');
    const total = get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM deliveries d JOIN suppliers s ON s.id = d.supplier_id WHERE ${where}`,
      params,
    )?.count ?? 0;
    const rows = all(
      `SELECT d.*, s.name AS supplier_name, t.code AS tank_code, p.name AS product_name,
              st.name AS station_name,
              (SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) FROM payments pm
                WHERE pm.supplier_id = d.supplier_id AND pm.tenant_id = d.tenant_id AND pm.direction = 'PAYOUT') AS supplier_paid_total
         FROM deliveries d
         JOIN suppliers s ON s.id = d.supplier_id
         JOIN tanks t ON t.id = d.tank_id
         JOIN fuel_products p ON p.id = d.product_id
         JOIN stations st ON st.id = d.station_id
        WHERE ${where} ORDER BY d.invoice_date DESC, d.created_at DESC LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

// TT decantation ke saath ka record: dip pehle/baad, density, seal, sample.
// Yehi saboot hota hai jab maal kam aaye aur OMC se claim karna pade.
const decantationFields = {
  dipBeforeCm: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  dipAfterCm: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  densityInvoice: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  densityObserved: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  tempObservedC: z.union([z.string(), z.number()]).transform(String).optional().nullable(),
  ttSealNumbers: z.string().max(200).optional().nullable(),
  sampleSealNo: z.string().max(60).optional().nullable(),
  chamberDetails: z.string().max(500).optional().nullable(),
};

type DecantationInput = Partial<Record<keyof typeof decantationFields, string | null | undefined>>;

/** Observed density + temperature se 15°C corrected density (agar dono diye hon). */
function densityAt15For(productId: string, body: DecantationInput): string | null {
  if (!body.densityObserved || !body.tempObservedC) return null;
  const product = get<{ category: string }>('SELECT category FROM fuel_products WHERE id = ?', [productId]);
  return evaluateDensity(product?.category ?? 'DIESEL', body.densityObserved, body.tempObservedC).densityAt15c;
}

const deliverySchema = z.object({
  stationId: z.string().min(3),
  supplierId: z.string().min(3),
  invoiceNumber: z.string().min(1).max(60),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  productId: z.string().min(3),
  tankId: z.string().min(3),
  quantityLitres: z.union([z.string(), z.number()]).transform(String),
  ratePerLitre: z.union([z.string(), z.number()]).transform(String),
  taxAmount: z.union([z.string(), z.number()]).transform(String).optional(),
  vehicleNumber: z.string().max(24).optional().nullable(),
  driverName: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  receiveNow: z.boolean().default(false),
  receivedLitres: z.union([z.string(), z.number()]).transform(String).optional(),
  ...decantationFields,
});

inventoryRouter.post(
  '/deliveries',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'deliveries.write')) throw forbidden();
    const body = parseRequestBody(deliverySchema, req.body);
    const station = getStationOrThrow(auth, body.stationId);
    assertDayOpen(station.id, body.receiveNow ? businessDateOf(nowIso()) : body.invoiceDate);
    const tank = tankInTenant(auth, body.tankId);
    if (tank.station_id !== station.id) throw unprocessable('Tank does not belong to this station');
    if (tank.product_id !== body.productId) throw unprocessable('Tank holds a different fuel product');
    const supplier = get('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?', [body.supplierId, station.tenant_id]);
    if (!supplier) throw notFound('Supplier not found');
    if (get('SELECT id FROM deliveries WHERE tenant_id = ? AND supplier_id = ? AND invoice_number = ?', [
      station.tenant_id, body.supplierId, body.invoiceNumber,
    ])) {
      throw conflict('This supplier invoice number has already been recorded');
    }
    const quantity = D(body.quantityLitres);
    const rate = D(body.ratePerLitre);
    if (quantity.lte(0)) throw unprocessable('Quantity must be greater than zero');
    if (rate.lte(0)) throw unprocessable('Rate must be greater than zero');
    const tax = D(body.taxAmount ?? 0);
    const taxable = quantity.mul(rate);
    const total = taxable.plus(tax);
    const received = body.receiveNow ? D(body.receivedLitres ?? body.quantityLitres) : null;
    if (received && received.lte(0)) throw unprocessable('Received quantity must be greater than zero');
    const id = newId('dlv');
    const status = body.receiveNow ? 'RECEIVED' : 'DRAFT';
    tx(() => {
      run(
        `INSERT INTO deliveries
          (id, tenant_id, station_id, supplier_id, invoice_number, invoice_date, product_id, tank_id,
           quantity_litres, received_litres, rate_per_litre, taxable_amount, tax_amount, total_amount, status,
           received_at, vehicle_number, driver_name, dip_before_cm, dip_after_cm, density_invoice,
           density_observed, temp_observed_c, density_at_15c, tt_seal_numbers, sample_seal_no, chamber_details,
           notes, is_demo, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [id, station.tenant_id, station.id, body.supplierId, body.invoiceNumber, body.invoiceDate,
          body.productId, body.tankId, quantity.toFixed(3), received ? received.toFixed(3) : null,
          fmtRate(rate), money(taxable), money(tax), money(total), status,
          body.receiveNow ? nowIso() : null, body.vehicleNumber ?? null, body.driverName ?? null,
          body.dipBeforeCm ?? null, body.dipAfterCm ?? null, body.densityInvoice ?? null,
          body.densityObserved ?? null, body.tempObservedC ?? null, densityAt15For(body.productId, body),
          body.ttSealNumbers ?? null, body.sampleSealNo ?? null, body.chamberDetails ?? null,
          body.notes ?? null, auth.user.id, nowIso(), nowIso()],
      );
      if (received && received.gt(0)) {
        recordMovement({
          tenantId: station.tenant_id,
          stationId: station.id,
          tankId: body.tankId,
          productId: body.productId,
          type: 'DELIVERY',
          quantityLitres: received.toFixed(3),
          referenceType: 'DELIVERY',
          referenceId: id,
          note: `Delivery invoice ${body.invoiceNumber}`,
          createdBy: auth.user.id,
        });
      }
    });
    audit(req, {
      action: 'DELIVERY_RECORDED', entity: 'Delivery', entityId: id, stationId: station.id,
      summary: `Invoice ${body.invoiceNumber} from ${String(supplier.name)}: ${quantity.toFixed(3)} L @ ₹${fmtRate(rate)} (${status})`,
      after: { total: money(total), receivedLitres: received ? received.toFixed(3) : null },
    });
    return created(res, shape(get('SELECT * FROM deliveries WHERE id = ?', [id])));
  }),
);

inventoryRouter.post(
  '/deliveries/:id/receive',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'deliveries.write')) throw forbidden();
    const delivery = get<Record<string, unknown>>('SELECT * FROM deliveries WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!delivery) throw notFound('Delivery not found');
    const station = getStationOrThrow(auth, String(delivery.station_id));
    if (delivery.status === 'RECEIVED') throw conflict('Delivery is already received');
    if (delivery.status === 'DISPUTED') throw conflict('Resolve the dispute before receiving this delivery');
    const body = parseRequestBody(
      z.object({
        receivedLitres: z.union([z.string(), z.number()]).transform(String),
        receivedAt: z.string().datetime().optional(),
        notes: z.string().max(500).optional().nullable(),
        ...decantationFields,
      }),
      req.body,
    );
    const received = D(body.receivedLitres);
    if (received.lte(0)) throw unprocessable('Received quantity must be greater than zero');
    const ordered = D(delivery.quantity_litres as string);
    if (received.gt(ordered.mul(1.02))) throw unprocessable('Received quantity exceeds the invoiced quantity by more than 2%');
    const receivedAt = body.receivedAt ?? nowIso();
    assertDayOpen(station.id, businessDateOf(receivedAt));
    tx(() => {
      run(
        `UPDATE deliveries SET status = 'RECEIVED', received_litres = ?, received_at = ?,
                dip_before_cm = COALESCE(?, dip_before_cm), dip_after_cm = COALESCE(?, dip_after_cm),
                density_invoice = COALESCE(?, density_invoice), density_observed = COALESCE(?, density_observed),
                temp_observed_c = COALESCE(?, temp_observed_c), density_at_15c = COALESCE(?, density_at_15c),
                tt_seal_numbers = COALESCE(?, tt_seal_numbers), sample_seal_no = COALESCE(?, sample_seal_no),
                chamber_details = COALESCE(?, chamber_details),
                notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
        [received.toFixed(3), receivedAt,
          body.dipBeforeCm ?? null, body.dipAfterCm ?? null, body.densityInvoice ?? null,
          body.densityObserved ?? null, body.tempObservedC ?? null,
          densityAt15For(String(delivery.product_id), body),
          body.ttSealNumbers ?? null, body.sampleSealNo ?? null, body.chamberDetails ?? null,
          body.notes ?? null, nowIso(), String(delivery.id)],
      );
      recordMovement({
        tenantId: String(delivery.tenant_id),
        stationId: station.id,
        tankId: String(delivery.tank_id),
        productId: String(delivery.product_id),
        type: 'DELIVERY',
        quantityLitres: received.toFixed(3),
        occurredAt: receivedAt,
        referenceType: 'DELIVERY',
        referenceId: String(delivery.id),
        note: `Delivery invoice ${String(delivery.invoice_number)}`,
        createdBy: auth.user.id,
      });
    });
    const discrepancy = received.minus(ordered);
    audit(req, {
      action: 'DELIVERY_RECEIVED', entity: 'Delivery', entityId: String(delivery.id), stationId: station.id,
      summary: `Invoice ${String(delivery.invoice_number)}: received ${received.toFixed(3)} L of ${ordered.toFixed(3)} L${discrepancy.abs().gt(0) ? ` (${discrepancy.toFixed(3)} L discrepancy)` : ''}`,
      after: { receivedLitres: received.toFixed(3), discrepancyLitres: discrepancy.toFixed(3) },
    });
    return ok(res, {
      ...(shape(get('SELECT * FROM deliveries WHERE id = ?', [String(delivery.id)])) as Record<string, unknown>),
      discrepancyLitres: discrepancy.toFixed(3),
    });
  }),
);

inventoryRouter.post(
  '/deliveries/:id/dispute',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'deliveries.write')) throw forbidden();
    const delivery = get<Record<string, unknown>>('SELECT * FROM deliveries WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!delivery) throw notFound('Delivery not found');
    const station = getStationOrThrow(auth, String(delivery.station_id));
    if (delivery.status === 'RECEIVED') throw conflict('Received deliveries cannot be disputed — raise a stock adjustment instead');
    const body = parseRequestBody(z.object({ reason: z.string().min(5).max(500) }), req.body);
    run("UPDATE deliveries SET status = 'DISPUTED', notes = ?, updated_at = ? WHERE id = ?", [
      `Disputed: ${body.reason}`, nowIso(), String(delivery.id),
    ]);
    audit(req, {
      action: 'DELIVERY_DISPUTED', entity: 'Delivery', entityId: String(delivery.id), stationId: station.id,
      summary: `Invoice ${String(delivery.invoice_number)} disputed: ${body.reason}`,
    });
    return ok(res, shape(get('SELECT * FROM deliveries WHERE id = ?', [String(delivery.id)])));
  }),
);

// ------------------------------------------------- adjustments & transfers

inventoryRouter.post(
  '/adjustments',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.write')) throw forbidden();
    const body = parseRequestBody(
      z.object({
        tankId: z.string().min(3),
        quantityLitres: z.union([z.string(), z.number()]).transform(String),
        reason: z.string().min(5).max(300),
        occurredAt: z.string().datetime().optional(),
      }),
      req.body,
    );
    const tank = tankInTenant(auth, body.tankId);
    const station = getStationOrThrow(auth, String(tank.station_id));
    const qty = D(body.quantityLitres);
    if (qty.isZero()) throw unprocessable('Adjustment quantity cannot be zero');
    const id = recordMovement({
      tenantId: station.tenant_id,
      stationId: station.id,
      tankId: String(tank.id),
      productId: String(tank.product_id),
      type: 'ADJUSTMENT',
      quantityLitres: qty.negated().toFixed(3),
      occurredAt: body.occurredAt ?? nowIso(),
      referenceType: 'MANUAL',
      note: body.reason,
      createdBy: auth.user.id,
    });
    audit(req, {
      action: 'STOCK_ADJUSTED', entity: 'StockMovement', entityId: id, stationId: station.id,
      summary: `Tank ${String(tank.code)}: ${qty.gt(0) ? '+' : ''}${qty.toFixed(3)} L — ${body.reason}`,
      after: { bookStockLitres: tankBookStock(String(tank.id)).toFixed(3) },
    });
    return created(res, shape(get('SELECT * FROM stock_movements WHERE id = ?', [id])));
  }),
);

inventoryRouter.post(
  '/transfers',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.write')) throw forbidden();
    const body = parseRequestBody(
      z.object({
        fromTankId: z.string().min(3),
        toTankId: z.string().min(3),
        quantityLitres: z.union([z.string(), z.number()]).transform(String),
        reason: z.string().min(5).max(300),
      }),
      req.body,
    );
    if (body.fromTankId === body.toTankId) throw unprocessable('Source and destination tanks must differ');
    const from = tankInTenant(auth, body.fromTankId);
    const to = tankInTenant(auth, body.toTankId);
    if (from.station_id !== to.station_id) throw unprocessable('Inter-station transfers are not supported');
    if (from.product_id !== to.product_id) throw unprocessable('Both tanks must hold the same fuel product');
    const station = getStationOrThrow(auth, String(from.station_id));
    const quantity = D(body.quantityLitres);
    if (quantity.lte(0)) throw unprocessable('Transfer quantity must be greater than zero');
    const available = tankBookStock(String(from.id));
    if (quantity.gt(available)) {
      throw unprocessable(`Only ${available.toFixed(3)} L book stock is available in ${String(from.code)}`);
    }
    const referenceId = newId('trf');
    tx(() => {
      recordMovement({
        tenantId: station.tenant_id, stationId: station.id, tankId: String(from.id),
        productId: String(from.product_id), type: 'TRANSFER_OUT', quantityLitres: quantity.toFixed(3),
        referenceType: 'TRANSFER', referenceId, note: `Transfer to ${String(to.code)}: ${body.reason}`, createdBy: auth.user.id,
      });
      recordMovement({
        tenantId: station.tenant_id, stationId: station.id, tankId: String(to.id),
        productId: String(to.product_id), type: 'TRANSFER_IN', quantityLitres: quantity.toFixed(3),
        referenceType: 'TRANSFER', referenceId, note: `Transfer from ${String(from.code)}: ${body.reason}`, createdBy: auth.user.id,
      });
    });
    audit(req, {
      action: 'STOCK_TRANSFERRED', entity: 'StockMovement', entityId: referenceId, stationId: station.id,
      summary: `${quantity.toFixed(3)} L transferred ${String(from.code)} → ${String(to.code)}: ${body.reason}`,
    });
    return created(res, { referenceId, quantityLitres: quantity.toFixed(3) });
  }),
);

inventoryRouter.post(
  '/opening-stock',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.write')) throw forbidden();
    const body = parseRequestBody(
      z.object({
        tankId: z.string().min(3),
        litres: z.union([z.string(), z.number()]).transform(String),
        occurredAt: z.string().datetime().optional(),
      }),
      req.body,
    );
    const tank = tankInTenant(auth, body.tankId);
    const station = getStationOrThrow(auth, String(tank.station_id));
    const qty = D(body.litres);
    if (qty.lt(0)) throw unprocessable('Opening stock cannot be negative');
    const existing = get<{ id: string }>(
      "SELECT id FROM stock_movements WHERE tank_id = ? AND type = 'OPENING'",
      [String(tank.id)],
    );
    let movementId: string;
    tx(() => {
      if (existing) {
        const others = get<{ count: number }>(
          "SELECT COUNT(*) AS count FROM stock_movements WHERE tank_id = ? AND type != 'OPENING'",
          [String(tank.id)],
        )?.count ?? 0;
        if (others > 0) throw conflict('Stock has already moved for this tank — record an adjustment instead');
        run('UPDATE stock_movements SET quantity_litres = ?, occurred_at = ?, created_by = ? WHERE id = ?', [
          qty.toFixed(3), body.occurredAt ?? nowIso(), auth.user.id, existing.id,
        ]);
        movementId = existing.id;
      } else {
        movementId = recordMovement({
          tenantId: station.tenant_id, stationId: station.id, tankId: String(tank.id),
          productId: String(tank.product_id), type: 'OPENING', quantityLitres: qty.toFixed(3),
          occurredAt: body.occurredAt ?? nowIso(), referenceType: 'MANUAL',
          note: 'Opening stock', createdBy: auth.user.id,
        });
      }
    });
    audit(req, {
      action: 'OPENING_STOCK_SET', entity: 'StockMovement', entityId: movementId!,
      stationId: station.id, summary: `${String(tank.code)} opening stock ${qty.toFixed(3)} L`,
    });
    return created(res, shape(get('SELECT * FROM stock_movements WHERE id = ?', [movementId!])));
  }),
);

inventoryRouter.get(
  '/tanks/:id/ledger',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'stock.read')) throw forbidden();
    const tank = tankInTenant(auth, req.params.id);
    const rows = all<{ id: string; type: string; quantity_litres: string; occurred_at: string; note: string | null }>(
      'SELECT * FROM stock_movements WHERE tank_id = ? ORDER BY occurred_at ASC, created_at ASC',
      [String(tank.id)],
    );
    let running = D(0);
    const ledger = rows.map((row) => {
      const signed = signedLitres(row.type, row.quantity_litres);
      running = running.plus(signed);
      return {
        id: row.id,
        type: row.type,
        quantityLitres: row.quantity_litres,
        signedLitres: signed.toFixed(3),
        runningLitres: running.toFixed(3),
        occurredAt: row.occurred_at,
        note: row.note,
      };
    });
    return ok(res, {
      tank: {
        id: tank.id,
        code: tank.code,
        name: tank.name,
        capacityLitres: tank.capacity_litres,
        productId: tank.product_id,
      },
      closingBookStock: running.toFixed(3),
      ledger,
    });
  }),
);

/** Local wrapper so validation errors keep the 422 shape used across the API. */
function parseRequestBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  throw unprocessable('Validation failed', {
    issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  });
}
