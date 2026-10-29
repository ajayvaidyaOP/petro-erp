import { Router } from 'express';
import { z } from 'zod';
import { PAYMENT_MODES } from '../shared/index.js';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, created, ok, parse, pageMeta, paging } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso, businessDateOf } from '../lib/time.js';
import { D, money } from '../lib/decimal.js';
import { assertDayOpen } from '../lib/dayclose.js';

export const lubricantsRouter = Router();
lubricantsRouter.use(requireAuth);

const decimalInput = z.union([z.string(), z.number()]).transform(String);

function lubeStockQty(stationId: string, productId: string) {
  const rows = all<{ quantity: string }>(
    'SELECT quantity FROM lube_movements WHERE station_id = ? AND product_id = ?',
    [stationId, productId],
  );
  return rows.reduce((acc, row) => acc.plus(D(row.quantity)), D(0));
}

function productInTenant(auth: AuthContext, productId: string) {
  const product = get<Record<string, unknown>>('SELECT * FROM lube_products WHERE id = ? AND tenant_id = ?', [
    productId, tenantIdOf(auth),
  ]);
  if (!product) throw notFound('Lubricant product not found');
  return product;
}

// --------------------------------------------------------------- products
lubricantsRouter.get(
  '/products',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'lubricants.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const products = all<Record<string, unknown>>(
      'SELECT * FROM lube_products WHERE tenant_id = ? ORDER BY name, pack_size',
      [tenantIdOf(auth)],
    );
    const withStock = products.map((product) => ({
      ...shape(product),
      stockQty: lubeStockQty(station.id, String(product.id)).toFixed(2),
    }));
    return ok(res, withStock);
  }),
);

const productSchema = z.object({
  code: z.string().trim().toUpperCase().pipe(z.string().min(2).max(24)),
  name: z.string().min(2).max(100),
  brand: z.string().max(60).optional().nullable(),
  packSize: z.string().min(1).max(24).default('1 L'),
  hsnCode: z.string().max(12).optional().nullable(),
  gstRatePct: decimalInput.optional(),
  purchaseRate: decimalInput.optional(),
  saleRate: decimalInput.optional(),
  isActive: z.boolean().optional(),
});

lubricantsRouter.post(
  '/products',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'lubricants.write')) throw forbidden();
    const body = parse(productSchema, req.body);
    const id = newId('lub');
    try {
      run(
        `INSERT INTO lube_products
          (id, tenant_id, code, name, brand, pack_size, hsn_code, gst_rate_pct, purchase_rate, sale_rate, is_active, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, tenantIdOf(auth), body.code, body.name, body.brand ?? null, body.packSize, body.hsnCode ?? null,
          body.gstRatePct ?? '18', money(D(body.purchaseRate ?? 0)), money(D(body.saleRate ?? 0)),
          body.isActive === false ? 0 : 1, nowIso(), nowIso()],
      );
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) throw conflict('Is code se lubricant pehle se hai');
      throw error;
    }
    audit(req, {
      action: 'LUBE_PRODUCT_CREATED', entity: 'LubeProduct', entityId: id,
      summary: `${body.name} (${body.packSize}) lubricant catalog me joda gaya`,
    });
    return created(res, shape(get('SELECT * FROM lube_products WHERE id = ?', [id])));
  }),
);

lubricantsRouter.patch(
  '/products/:id',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'lubricants.write')) throw forbidden();
    const product = productInTenant(auth, req.params.id);
    const body = parse(productSchema.omit({ code: true }).partial(), req.body);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const map: [string, string, unknown][] = [
      ['name', 'name', body.name], ['brand', 'brand', body.brand], ['packSize', 'pack_size', body.packSize],
      ['hsnCode', 'hsn_code', body.hsnCode], ['gstRatePct', 'gst_rate_pct', body.gstRatePct],
      ['purchaseRate', 'purchase_rate', body.purchaseRate ? money(D(body.purchaseRate)) : undefined],
      ['saleRate', 'sale_rate', body.saleRate ? money(D(body.saleRate)) : undefined],
      ['isActive', 'is_active', body.isActive === undefined ? undefined : body.isActive ? 1 : 0],
    ];
    for (const [, column, value] of map) {
      if (value !== undefined) { sets.push(`${column} = ?`); params.push(value as string | number | null); }
    }
    if (sets.length === 0) throw unprocessable('Badalne ke liye koi field nahi diya');
    run(`UPDATE lube_products SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, nowIso(), String(product.id)]);
    audit(req, {
      action: 'LUBE_PRODUCT_UPDATED', entity: 'LubeProduct', entityId: String(product.id),
      summary: `${String(product.name)} updated`, after: body as Record<string, unknown>,
    });
    return ok(res, shape(get('SELECT * FROM lube_products WHERE id = ?', [String(product.id)])));
  }),
);

// -------------------------------------------------------------- movements
lubricantsRouter.get(
  '/movements',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'lubricants.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const p = paging(req.query as Record<string, unknown>);
    const total = get<{ count: number }>('SELECT COUNT(*) AS count FROM lube_movements WHERE station_id = ?', [station.id])?.count ?? 0;
    const rows = all(
      `SELECT m.*, p.name AS product_name, p.pack_size, p.code AS product_code,
              c.name AS customer_name, s.name AS supplier_name
         FROM lube_movements m
         JOIN lube_products p ON p.id = m.product_id
         LEFT JOIN customers c ON c.id = m.customer_id
         LEFT JOIN suppliers s ON s.id = m.supplier_id
        WHERE m.station_id = ?
        ORDER BY m.occurred_at DESC LIMIT ? OFFSET ?`,
      [station.id, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

lubricantsRouter.post(
  '/movements',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'lubricants.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        productId: z.string().min(3),
        type: z.enum(['OPENING', 'PURCHASE', 'SALE', 'ADJUSTMENT']),
        // ADJUSTMENT me signed (ghata/bढ़ा) chalega; बाकी sab positive quantity.
        quantity: decimalInput,
        rate: decimalInput.optional(),
        paymentMode: z.enum(PAYMENT_MODES).optional().nullable(),
        customerId: z.string().min(3).optional().nullable(),
        vehicleNumber: z.string().max(20).optional().nullable(),
        supplierId: z.string().min(3).optional().nullable(),
        reference: z.string().max(80).optional().nullable(),
        occurredAt: z.string().datetime().optional(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const product = productInTenant(auth, body.productId);
    const qty = D(body.quantity);
    if (qty.isZero()) throw unprocessable('Quantity zero nahi ho sakti');
    if (body.type !== 'ADJUSTMENT' && qty.lt(0)) throw unprocessable('Quantity positive daalo');
    const occurredAt = body.occurredAt ?? nowIso();
    assertDayOpen(station.id, businessDateOf(occurredAt));

    // Sign convention: PURCHASE/OPENING andar (+), SALE bahar (-), ADJUSTMENT jaisa diya waisa.
    const signedQty = body.type === 'SALE' ? qty.abs().negated() : body.type === 'ADJUSTMENT' ? qty : qty.abs();
    const defaultRate = body.type === 'SALE' ? D(String(product.sale_rate)) : D(String(product.purchase_rate));
    const rate = body.rate !== undefined ? D(body.rate) : defaultRate;
    const amount = signedQty.abs().mul(rate);

    if (body.type === 'SALE' && !body.paymentMode) throw unprocessable('Sale ke liye payment mode (Cash/UPI/Card/Credit) zaroori hai');
    if (body.type === 'SALE' && body.paymentMode === 'CREDIT' && !body.customerId) {
      throw unprocessable('Credit sale ke liye customer select karo');
    }
    if (body.customerId) {
      const customer = get('SELECT id FROM customers WHERE id = ? AND tenant_id = ?', [body.customerId, tenantIdOf(auth)]);
      if (!customer) throw notFound('Customer not found');
    }

    const id = newId('lum');
    tx(() => {
      if (signedQty.lt(0)) {
        const stock = lubeStockQty(station.id, String(product.id));
        if (stock.plus(signedQty).lt(0)) {
          throw unprocessable(`Stock kam hai: sirf ${stock.toFixed(2)} pack bache hain, ${signedQty.abs().toFixed(2)} nahi nikal sakte`);
        }
      }
      run(
        `INSERT INTO lube_movements
          (id, tenant_id, station_id, product_id, type, quantity, rate, amount, payment_mode, customer_id,
           vehicle_number, supplier_id, reference, occurred_at, note, created_by, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [id, tenantIdOf(auth), station.id, String(product.id), body.type, signedQty.toFixed(2), money(rate), money(amount),
          body.paymentMode ?? null, body.customerId ?? null, body.vehicleNumber ?? null, body.supplierId ?? null,
          body.reference ?? null, occurredAt, body.note ?? null, auth.user.id, nowIso()],
      );
      // Credit par becha to customer ke khate me bhi chadhna chahiye.
      if (body.type === 'SALE' && body.paymentMode === 'CREDIT' && body.customerId) {
        const customer = get<{ balance: string }>('SELECT balance FROM customers WHERE id = ?', [body.customerId])!;
        run(
          `INSERT INTO credit_entries
            (id, tenant_id, station_id, customer_id, type, amount, vehicle_number, reference, occurred_at, note, status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'CREDIT_SALE', ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
          [newId('cre'), tenantIdOf(auth), station.id, body.customerId, money(amount), body.vehicleNumber ?? null,
            body.reference ?? `LUBE-${String(product.code)}`, occurredAt,
            `Lubricant sale: ${String(product.name)} ${String(product.pack_size)} x ${qty.abs().toFixed(2)}`,
            auth.user.id, nowIso()],
        );
        run('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?', [
          money(D(customer.balance).plus(amount)), nowIso(), body.customerId,
        ]);
      }
    });
    audit(req, {
      action: `LUBE_${body.type}_RECORDED`, entity: 'LubeMovement', entityId: id, stationId: station.id,
      summary: `${String(product.name)} (${String(product.pack_size)}): ${body.type} ${qty.abs().toFixed(2)} pack @ ₹${money(rate)}`,
      after: { type: body.type, quantity: signedQty.toFixed(2), amount: money(amount) },
    });
    return created(res, shape(get('SELECT * FROM lube_movements WHERE id = ?', [id])));
  }),
);
