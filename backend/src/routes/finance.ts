import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, tx } from '../db/index.js';
import { asyncHandler, created, dayParam, ok, pageMeta, paging, parse, sortClause } from '../lib/http.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { istDayEnd, istDayStart, isIsoDate, nowIso, todayIst } from '../lib/time.js';
import { D, money } from '../lib/decimal.js';
import { idempotent } from '../lib/idempotency.js';

export const financeRouter = Router();
financeRouter.use(requireAuth);

const isoDateTime = z.string().min(10).max(40);

function customerInTenant(auth: AuthContext, customerId: string) {
  const customer = get<Record<string, unknown>>('SELECT * FROM customers WHERE id = ? AND tenant_id = ?', [
    customerId, tenantIdOf(auth),
  ]);
  if (!customer) throw notFound('Customer not found');
  return customer;
}

function supplierInTenant(auth: AuthContext, supplierId: string) {
  const supplier = get<Record<string, unknown>>('SELECT * FROM suppliers WHERE id = ? AND tenant_id = ?', [
    supplierId, tenantIdOf(auth),
  ]);
  if (!supplier) throw notFound('Supplier not found');
  return supplier;
}

function customerBalance(customerId: string) {
  const row = get<{ balance: string }>('SELECT balance FROM customers WHERE id = ?', [customerId]);
  return D(row?.balance ?? 0);
}

// ------------------------------------------------------------ credit ledger

financeRouter.get(
  '/customer-ledger',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.read')) throw forbidden();
    const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : null;
    if (!customerId) throw unprocessable('customerId is required');
    const customer = customerInTenant(auth, customerId);
    const entries = all<Record<string, unknown>>(
      `SELECT ce.*, st.name AS station_name, u.name AS created_by_name
         FROM credit_entries ce
         LEFT JOIN stations st ON st.id = ce.station_id
         LEFT JOIN users u ON u.id = ce.created_by
        WHERE ce.customer_id = ? AND ce.status = 'POSTED'
        ORDER BY ce.occurred_at ASC, ce.created_at ASC`,
      [customerId],
    );
    let running = D(String(customer.opening_balance ?? 0));
    const ledger = entries.map((entry) => {
      const amount = D(entry.amount as string);
      if (entry.type === 'CREDIT_SALE') running = running.plus(amount);
      else if (entry.type === 'PAYMENT') running = running.minus(amount);
      else running = running.plus(amount);
      const overdue = entry.due_date && new Date(String(entry.due_date)).getTime() < Date.now() && entry.type === 'CREDIT_SALE';
      return {
        ...shape(entry),
        debit: entry.type === 'CREDIT_SALE' ? money(amount) : '0.00',
        credit: entry.type === 'PAYMENT' ? money(amount) : '0.00',
        runningBalance: money(running),
        overdue: Boolean(overdue),
      };
    });
    const overdueTotal = entries
      .filter((entry) => entry.type === 'CREDIT_SALE' && entry.due_date && new Date(String(entry.due_date)).getTime() < Date.now())
      .reduce((acc, entry) => acc.plus(D(String(entry.amount))), D(0));
    return ok(res, {
      customer: shape(customer),
      ledger,
      closingBalance: money(running),
      creditLimit: String(customer.credit_limit),
      availableCredit: money(D(String(customer.credit_limit)).minus(running)),
      overdueAmount: money(overdueTotal),
      note: 'A credit sale increases the customer balance; a receipt reduces it. Payment mode does not change the credit balance until a receipt is recorded.',
    });
  }),
);

financeRouter.post(
  '/credit-sales',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'sales.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        customerId: z.string().min(3),
        amount: z.union([z.string(), z.number()]).transform(String),
        reference: z.string().max(80).optional().nullable(),
        occurredAt: isoDateTime.optional(),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const customer = customerInTenant(auth, body.customerId);
    const amount = D(body.amount);
    if (amount.lte(0)) throw unprocessable('Credit sale amount must be greater than zero');
    const balance = customerBalance(String(customer.id));
    const limit = D(customer.credit_limit as string);
    if (limit.gt(0) && balance.plus(amount).gt(limit)) {
      throw unprocessable(
        `Credit limit exceeded: outstanding ${money(balance)}, limit ${money(limit)}, requested ${money(amount)}`,
      );
    }
    const dueDate = body.dueDate ?? (Number(customer.credit_days) > 0
      ? new Date(Date.now() + Number(customer.credit_days) * 86_400_000).toISOString().slice(0, 10)
      : null);
    const outcome = idempotent(req, auth, 'credit-sale', () => {
      const entryId = newId('cre');
      tx(() => {
        run(
          `INSERT INTO credit_entries
            (id, tenant_id, station_id, customer_id, type, amount, reference, occurred_at, due_date, note,
             status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'CREDIT_SALE', ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
          [entryId, tenantIdOf(auth), station.id, customer.id, money(amount), body.reference ?? null,
            body.occurredAt ?? nowIso(), dueDate, body.note ?? null, auth.user.id, nowIso()],
        );
        run('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?', [
          money(balance.plus(amount)), nowIso(), customer.id,
        ]);
      });
      audit(req, {
        action: 'CREDIT_SALE_RECORDED', entity: 'CreditEntry', entityId: entryId, stationId: station.id,
        summary: `${String(customer.name)}: credit sale ${money(amount)} (balance ${money(balance.plus(amount))})`,
        after: { amount: money(amount), dueDate },
      });
      return {
        id: entryId,
        customerId: customer.id,
        amount: money(amount),
        dueDate,
        newBalance: money(balance.plus(amount)),
      };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replay', 'true');
    return res.status(outcome.status).json({ data: { ...outcome.data, replayed: outcome.replayed } });
  }),
);

financeRouter.get(
  '/receivables',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'customers.read')) throw forbidden();
    const rows = all<Record<string, unknown>>(
      `SELECT c.id, c.code, c.name, c.phone, c.balance, c.credit_limit, c.credit_days,
              (SELECT MAX(due_date) FROM credit_entries ce
                WHERE ce.customer_id = c.id AND ce.type = 'CREDIT_SALE' AND ce.status = 'POSTED'
                  AND CAST(ce.amount AS REAL) > 0) AS last_due_date,
              (SELECT MIN(occurred_at) FROM credit_entries ce
                WHERE ce.customer_id = c.id AND ce.type = 'CREDIT_SALE' AND ce.status = 'POSTED') AS oldest_credit_at
         FROM customers c
        WHERE c.tenant_id = ? AND c.status = 'ACTIVE' AND CAST(c.balance AS REAL) > 0
        ORDER BY CAST(c.balance AS REAL) DESC`,
      [tenantIdOf(auth)],
    );
    const rowsOut = shapeAll(rows).map((row: Record<string, unknown>) => ({
      ...row,
      overLimit: D(String(row.creditLimit)).gt(0) && D(String(row.balance)).gt(D(String(row.creditLimit))),
      overdue: row.lastDueDate ? new Date(String(row.lastDueDate)).getTime() < Date.now() : false,
    }));
    const total = rowsOut.reduce((acc, row: Record<string, unknown>) => acc.plus(D(String(row.balance))), D(0));
    return ok(res, { receivables: rowsOut, totalOutstanding: money(total) });
  }),
);

// ----------------------------------------------------------- supplier ledger

financeRouter.get(
  '/supplier-ledger',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'suppliers.read')) throw forbidden();
    const supplierId = typeof req.query.supplierId === 'string' ? req.query.supplierId : null;
    if (!supplierId) throw unprocessable('supplierId is required');
    const supplier = supplierInTenant(auth, supplierId);
    const deliveries = all<Record<string, unknown>>(
      `SELECT d.id, d.invoice_number, d.invoice_date, d.total_amount, d.status, d.received_at, st.name AS station_name
         FROM deliveries d JOIN stations st ON st.id = d.station_id
        WHERE d.supplier_id = ? AND d.tenant_id = ? AND d.status != 'DRAFT'
        ORDER BY d.invoice_date ASC`,
      [supplierId, tenantIdOf(auth)],
    );
    const payments = all<Record<string, unknown>>(
      `SELECT p.*, st.name AS station_name FROM payments p JOIN stations st ON st.id = p.station_id
        WHERE p.supplier_id = ? AND p.tenant_id = ? AND p.direction = 'PAYOUT'
        ORDER BY p.occurred_at ASC`,
      [supplierId, tenantIdOf(auth)],
    );
    type Row = {
      id: string;
      date: string;
      type: string;
      description: string;
      reference: string | null;
      debit: string;
      credit: string;
      runningBalance: string;
    };
    const ledger: Row[] = [];
    let running = D(String(supplier.opening_balance ?? 0));
    for (const delivery of deliveries) {
      const amount = D(delivery.total_amount as string);
      running = running.plus(amount);
      ledger.push({
        id: String(delivery.id),
        date: String(delivery.invoice_date),
        type: 'PURCHASE',
        description: `Invoice ${String(delivery.invoice_number)} · ${String(delivery.station_name)}`,
        reference: String(delivery.invoice_number),
        debit: money(amount),
        credit: '0.00',
        runningBalance: money(running),
      });
    }
    for (const payment of payments) {
      const amount = D(payment.amount as string);
      if (payment.status === 'REVERSED') continue;
      running = running.minus(amount);
      ledger.push({
        id: String(payment.id),
        date: String(payment.occurred_at).slice(0, 10),
        type: 'PAYMENT',
        description: `Payout · ${String(payment.mode)}${payment.reference ? ` · ${String(payment.reference)}` : ''}`,
        reference: (payment.reference as string | null) ?? null,
        debit: '0.00',
        credit: money(amount),
        runningBalance: money(running),
      });
    }
    ledger.sort((a, b) => a.date.localeCompare(b.date));
    return ok(res, {
      supplier: shape(supplier),
      ledger,
      openingBalance: money(D(String(supplier.opening_balance ?? 0))),
      closingBalance: money(running),
      note: 'Purchases are recognised when a delivery is received. Supplier payouts reduce the payable without altering the purchase invoice.',
    });
  }),
);

// ------------------------------------------------------------------ payments

financeRouter.get(
  '/payments',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'payments.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['p.tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) {
      getStationOrThrow(auth, stationId);
      clauses.push('p.station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`p.station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
      params.push(...ids);
    }
    if (typeof req.query.reference === 'string' && req.query.reference) {
      clauses.push('p.reference = ?');
      params.push(req.query.reference);
    }
    for (const [key, column] of [['direction', 'p.direction'], ['mode', 'p.mode'], ['status', 'p.status']] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value) { clauses.push(`${column} = ?`); params.push(value); }
    }
    const payFrom = dayParam(req.query.from, 'from');
    const payTo = dayParam(req.query.to, 'to');
    if (payFrom) { clauses.push('p.occurred_at >= ?'); params.push(istDayStart(payFrom)); }
    if (payTo) { clauses.push('p.occurred_at <= ?'); params.push(istDayEnd(payTo)); }
    const where = clauses.join(' AND ');
    const order = sortClause(req.query as Record<string, unknown>, { occurredAt: 'p.occurred_at', amount: 'CAST(p.amount AS REAL)' }, 'p.occurred_at DESC');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM payments p WHERE ${where}`, params)?.count ?? 0;
    const rows = all(
      `SELECT p.*, c.name AS customer_name, s.name AS supplier_name, st.name AS station_name, u.name AS created_by_name
         FROM payments p
         LEFT JOIN customers c ON c.id = p.customer_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
         JOIN stations st ON st.id = p.station_id
         LEFT JOIN users u ON u.id = p.created_by
        WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, shapeAll(rows), pageMeta(total, p));
  }),
);

financeRouter.post(
  '/payments',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'payments.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        direction: z.enum(['RECEIPT', 'PAYOUT']),
        partyType: z.enum(['CUSTOMER', 'SUPPLIER']),
        customerId: z.string().min(3).optional().nullable(),
        supplierId: z.string().min(3).optional().nullable(),
        amount: z.union([z.string(), z.number()]).transform(String),
        mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK']).default('CASH'),
        reference: z.string().max(80).optional().nullable(),
        occurredAt: isoDateTime.optional(),
        notes: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const amount = D(body.amount);
    if (amount.lte(0)) throw unprocessable('Payment amount must be greater than zero');
    if (body.direction === 'RECEIPT' && !body.customerId) throw unprocessable('A receipt requires a customer');
    if (body.direction === 'PAYOUT' && !body.supplierId) throw unprocessable('A payout requires a supplier');
    const customer = body.customerId ? customerInTenant(auth, body.customerId) : null;
    const supplier = body.supplierId ? supplierInTenant(auth, body.supplierId) : null;
    const outcome = idempotent(req, auth, 'payment', () => {
      if (body.reference && get('SELECT id FROM payments WHERE tenant_id = ? AND reference = ?', [
        tenantIdOf(auth), body.reference,
      ])) {
        throw conflict('A payment with this reference already exists');
      }
      const id = newId('pmt');
      tx(() => {
        run(
          `INSERT INTO payments
            (id, tenant_id, station_id, direction, party_type, customer_id, supplier_id, amount, mode, reference,
             occurred_at, status, settlement_ref, settled_at, notes, created_by, is_demo, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [id, tenantIdOf(auth), station.id, body.direction, body.partyType, customer?.id ?? null,
            supplier?.id ?? null, money(amount), body.mode, body.reference ?? `pmt:${id}`,
            body.occurredAt ?? nowIso(), body.mode === 'CASH' ? 'SETTLED' : 'POSTED',
            body.mode === 'CASH' ? 'CASH-COLLECTED' : null, body.mode === 'CASH' ? nowIso() : null,
            body.notes ?? null, auth.user.id, nowIso()],
        );
        if (customer) {
          const balance = customerBalance(String(customer.id));
          const next = balance.minus(amount);
          run('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?', [
            money(next), nowIso(), customer.id,
          ]);
          run(
            `INSERT INTO credit_entries
              (id, tenant_id, station_id, customer_id, type, amount, reference, occurred_at, payment_id,
               note, status, created_by, created_at)
             VALUES (?, ?, ?, ?, 'PAYMENT', ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
            [newId('cre'), tenantIdOf(auth), station.id, customer.id, money(amount), body.reference ?? null,
              body.occurredAt ?? nowIso(), id, `Receipt via ${body.mode}`, auth.user.id, nowIso()],
          );
        }
      });
      audit(req, {
        action: body.direction === 'RECEIPT' ? 'PAYMENT_RECEIVED' : 'SUPPLIER_PAYOUT_RECORDED',
        entity: 'Payment', entityId: id, stationId: station.id,
        summary: `${body.direction} ${money(amount)} via ${body.mode}${customer ? ` from ${String(customer.name)}` : ''}${supplier ? ` to ${String(supplier.name)}` : ''}`,
        after: { amount: money(amount), mode: body.mode, reference: body.reference ?? `pmt:${id}` },
      });
      return {
        id,
        paymentId: id,
        amount: money(amount),
        mode: body.mode,
        status: body.mode === 'CASH' ? 'SETTLED' : 'POSTED',
        customerId: customer?.id ?? null,
        supplierId: supplier?.id ?? null,
        reference: body.reference ?? `pmt:${id}`,
      };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replay', 'true');
    return res.status(outcome.status).json({ data: { ...outcome.data, replayed: outcome.replayed } });
  }),
);

financeRouter.patch(
  '/payments/:id/settle',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'payments.write')) throw forbidden();
    const payment = get<Record<string, unknown>>('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!payment) throw notFound('Payment not found');
    getStationOrThrow(auth, String(payment.station_id));
    if (payment.status === 'REVERSED') throw conflict('Reversed payments cannot be settled');
    if (payment.status === 'SETTLED') throw conflict('Payment is already settled');
    const body = parse(z.object({ settlementRef: z.string().min(2).max(80) }), req.body);
    run("UPDATE payments SET status = 'SETTLED', settlement_ref = ?, settled_at = ? WHERE id = ?", [
      body.settlementRef, nowIso(), String(payment.id),
    ]);
    audit(req, {
      action: 'PAYMENT_SETTLED', entity: 'Payment', entityId: String(payment.id),
      stationId: String(payment.station_id), summary: `Settlement reference ${body.settlementRef}`,
    });
    return ok(res, shape(get('SELECT * FROM payments WHERE id = ?', [String(payment.id)])));
  }),
);

financeRouter.post(
  '/payments/:id/reverse',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'payments.write')) throw forbidden();
    const payment = get<Record<string, unknown>>('SELECT * FROM payments WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!payment) throw notFound('Payment not found');
    const station = getStationOrThrow(auth, String(payment.station_id));
    if (payment.status === 'REVERSED') throw conflict('Payment is already reversed');
    const body = parse(z.object({ reason: z.string().min(5).max(300) }), req.body);
    const amount = D(payment.amount as string);
    tx(() => {
      if (payment.customer_id) {
        const balance = customerBalance(String(payment.customer_id));
        const next = payment.direction === 'RECEIPT' ? balance.plus(amount) : balance.minus(amount);
        run('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?', [
          money(next), nowIso(), String(payment.customer_id),
        ]);
        run(
          `INSERT INTO credit_entries
            (id, tenant_id, station_id, customer_id, type, amount, reference, occurred_at, payment_id, note,
             status, created_by, created_at)
           VALUES (?, ?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
          [newId('cre'), tenantIdOf(auth), station.id, String(payment.customer_id),
            payment.direction === 'RECEIPT' ? money(amount.negated()) : money(amount),
            payment.reference ?? null, nowIso(), String(payment.id), `Reversal: ${body.reason}`,
            auth.user.id, nowIso()],
        );
      }
      run("UPDATE payments SET status = 'REVERSED', notes = ?, settled_at = ? WHERE id = ?", [
        `${payment.notes ? `${String(payment.notes)}\n` : ''}REVERSED: ${body.reason}`, nowIso(), String(payment.id),
      ]);
    });
    audit(req, {
      action: 'PAYMENT_REVERSED', entity: 'Payment', entityId: String(payment.id), stationId: station.id,
      summary: `Reversed ${String(payment.direction)} of ${money(amount)}: ${body.reason}`,
      before: { status: payment.status },
    });
    return ok(res, shape(get('SELECT * FROM payments WHERE id = ?', [String(payment.id)])));
  }),
);

// ------------------------------------------------------------------ expenses

financeRouter.get(
  '/expenses',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'expenses.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['e.tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (stationId) {
      getStationOrThrow(auth, stationId);
      clauses.push('e.station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`e.station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
      params.push(...ids);
    }
    const expFrom = dayParam(req.query.from, 'from');
    const expTo = dayParam(req.query.to, 'to');
    if (expFrom) { clauses.push('e.occurred_at >= ?'); params.push(istDayStart(expFrom)); }
    if (expTo) { clauses.push('e.occurred_at <= ?'); params.push(istDayEnd(expTo)); }
    if (typeof req.query.categoryId === 'string' && req.query.categoryId) {
      clauses.push('e.category_id = ?');
      params.push(req.query.categoryId);
    }
    const where = clauses.join(' AND ');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM expenses e WHERE ${where}`, params)?.count ?? 0;
    const sum = get<{ total: string }>(
      `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) AS total FROM expenses e WHERE ${where}`,
      params,
    );
    const rows = all(
      `SELECT e.*, st.name AS station_name, u.name AS created_by_name
         FROM expenses e JOIN stations st ON st.id = e.station_id
         LEFT JOIN users u ON u.id = e.created_by
        WHERE ${where} ORDER BY e.occurred_at DESC, e.created_at DESC LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    return ok(res, { expenses: shapeAll(rows), totalAmount: money(sum?.total ?? 0) }, pageMeta(total, p));
  }),
);

financeRouter.post(
  '/expenses',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'expenses.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        categoryId: z.string().min(3).optional().nullable(),
        categoryName: z.string().max(60).optional(),
        description: z.string().min(2).max(300),
        amount: z.union([z.string(), z.number()]).transform(String),
        occurredAt: isoDateTime.optional(),
        paidVia: z.enum(['CASH', 'UPI', 'CARD', 'BANK', 'CREDIT']).default('CASH'),
        reference: z.string().max(80).optional().nullable(),
        note: z.string().max(300).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const amount = D(body.amount);
    if (amount.lte(0)) throw unprocessable('Expense amount must be greater than zero');
    let categoryName = body.categoryName ?? 'General';
    if (body.categoryId) {
      const category = get<{ name: string }>('SELECT name FROM expense_categories WHERE id = ? AND tenant_id = ?', [
        body.categoryId, tenantIdOf(auth),
      ]);
      if (!category) throw notFound('Expense category not found');
      categoryName = category.name;
    }
    const outcome = idempotent(req, auth, 'expense', () => {
      const id = newId('exp');
      run(
        `INSERT INTO expenses
          (id, tenant_id, station_id, category_id, category_name, description, amount, occurred_at, paid_via,
           reference, note, created_by, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        [id, tenantIdOf(auth), station.id, body.categoryId ?? null, categoryName, body.description,
          money(amount), body.occurredAt ?? nowIso(), body.paidVia, body.reference ?? null,
          body.note ?? null, auth.user.id, nowIso()],
      );
      audit(req, {
        action: 'EXPENSE_RECORDED', entity: 'Expense', entityId: id, stationId: station.id,
        summary: `${categoryName}: ${body.description} ${money(amount)} via ${body.paidVia}`,
        after: { amount: money(amount), paidVia: body.paidVia },
      });
      return { id, amount: money(amount), categoryName, paidVia: body.paidVia };
    });
    if (outcome.replayed) res.setHeader('Idempotent-Replay', 'true');
    return res.status(outcome.status).json({ data: { ...outcome.data, replayed: outcome.replayed } });
  }),
);

financeRouter.delete(
  '/expenses/:id',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'expenses.write')) throw forbidden();
    const expense = get<Record<string, unknown>>('SELECT * FROM expenses WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!expense) throw notFound('Expense not found');
    getStationOrThrow(auth, String(expense.station_id));
    run('DELETE FROM expenses WHERE id = ?', [String(expense.id)]);
    audit(req, {
      action: 'EXPENSE_DELETED', entity: 'Expense', entityId: String(expense.id),
      stationId: String(expense.station_id),
      summary: `Deleted expense ${String(expense.description)} ${money(D(expense.amount as string))}`,
      before: shape(expense),
    });
    return ok(res, { deleted: true });
  }),
);

// ------------------------------------------------------------ reconciliation

function dayRange(businessDate: string) {
  if (!isIsoDate(businessDate)) throw unprocessable('businessDate must be YYYY-MM-DD');
  return { start: istDayStart(businessDate), end: istDayEnd(businessDate) };
}

function buildExpectations(stationId: string, businessDate: string) {
  const { start, end } = dayRange(businessDate);
  const sales = all<{ payment_mode: string; amount: string; quantity_litres: string; is_estimated: number }>(
    `SELECT payment_mode, amount, quantity_litres, is_estimated FROM fuel_transactions
      WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ? AND voided_at IS NULL`,
    [stationId, start, end],
  );
  const receipts = all<{ mode: string; amount: string }>(
    `SELECT mode, amount FROM payments
      WHERE station_id = ? AND direction = 'RECEIPT' AND status != 'REVERSED'
        AND occurred_at >= ? AND occurred_at <= ?`,
    [stationId, start, end],
  );
  const payouts = all<{ mode: string; amount: string }>(
    `SELECT mode, amount FROM payments
      WHERE station_id = ? AND direction = 'PAYOUT' AND status != 'REVERSED'
        AND occurred_at >= ? AND occurred_at <= ?`,
    [stationId, start, end],
  );
  const expenses = all<{ paid_via: string; amount: string }>(
    `SELECT paid_via, amount FROM expenses
      WHERE station_id = ? AND occurred_at >= ? AND occurred_at <= ?`,
    [stationId, start, end],
  );
  const creditEntries = all<{ amount: string }>(
    `SELECT amount FROM credit_entries
      WHERE station_id = ? AND type = 'CREDIT_SALE' AND status = 'POSTED'
        AND occurred_at >= ? AND occurred_at <= ?`,
    [stationId, start, end],
  );
  const shiftTotals = all<{ total_litres: string; total_value: string }>(
    `SELECT total_litres, total_value FROM shifts
      WHERE station_id = ? AND business_date = ? AND status IN ('CLOSED','FLAGGED','REVERSED')`,
    [stationId, businessDate],
  );

  const isCash = (mode: string) => mode === 'CASH';
  const cashSales = sales.filter((s) => isCash(s.payment_mode)).reduce((a, s) => a.plus(D(s.amount)), D(0));
  const digitalSales = sales.filter((s) => !isCash(s.payment_mode) && s.payment_mode !== 'CREDIT')
    .reduce((a, s) => a.plus(D(s.amount)), D(0));
  const creditSales = sales.filter((s) => s.payment_mode === 'CREDIT').reduce((a, s) => a.plus(D(s.amount)), D(0));
  const cashReceipts = receipts.filter((r) => isCash(r.mode)).reduce((a, r) => a.plus(D(r.amount)), D(0));
  const digitalReceipts = receipts.filter((r) => !isCash(r.mode)).reduce((a, r) => a.plus(D(r.amount)), D(0));
  const cashExpenses = expenses.filter((e) => isCash(e.paid_via)).reduce((a, e) => a.plus(D(e.amount)), D(0));
  const digitalExpenses = expenses.filter((e) => !isCash(e.paid_via) && e.paid_via !== 'CREDIT')
    .reduce((a, e) => a.plus(D(e.amount)), D(0));
  const cashPayouts = payouts.filter((p) => isCash(p.mode)).reduce((a, p) => a.plus(D(p.amount)), D(0));
  const digitalPayouts = payouts.filter((p) => !isCash(p.mode)).reduce((a, p) => a.plus(D(p.amount)), D(0));
  const aggregateLitres = shiftTotals.reduce((a, s) => a.plus(D(s.total_litres)), D(0));
  const aggregateValue = shiftTotals.reduce((a, s) => a.plus(D(s.total_value)), D(0));
  const creditFromLedger = creditEntries.reduce((a, c) => a.plus(D(c.amount)), D(0));
  const transactionLitres = sales.reduce((a, s) => a.plus(D(s.quantity_litres)), D(0));

  return {
    cash: cashSales.plus(cashReceipts).minus(cashExpenses).minus(cashPayouts),
    digital: digitalSales.plus(digitalReceipts).minus(digitalExpenses).minus(digitalPayouts),
    cashSales,
    digitalSales,
    creditSales: creditSales.plus(creditFromLedger),
    transactionLitres,
    cashReceipts,
    digitalReceipts,
    cashExpenses,
    digitalExpenses,
    cashPayouts,
    digitalPayouts,
    shiftAggregateLitres: aggregateLitres,
    shiftAggregateValue: aggregateValue,
  };
}

financeRouter.get(
  '/reconciliation',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reconciliation.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    const businessDate = typeof req.query.businessDate === 'string' ? req.query.businessDate : todayIst();
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const figures = buildExpectations(station.id, businessDate);
    const history = all<Record<string, unknown>>(
      `SELECT r.*, u.name AS created_by_name, a.name AS approved_by_name
         FROM reconciliations r
         LEFT JOIN users u ON u.id = r.created_by
         LEFT JOIN users a ON a.id = r.approved_by
        WHERE r.station_id = ? ORDER BY r.business_date DESC LIMIT 14`,
      [station.id],
    );
    return ok(res, {
      stationId: station.id,
      businessDate,
      expected: {
        cash: money(figures.cash),
        digital: money(figures.digital),
        cashSales: money(figures.cashSales),
        digitalSales: money(figures.digitalSales),
        creditSales: money(figures.creditSales),
        cashReceipts: money(figures.cashReceipts),
        digitalReceipts: money(figures.digitalReceipts),
        cashExpenses: money(figures.cashExpenses),
        digitalExpenses: money(figures.digitalExpenses),
        cashPayouts: money(figures.cashPayouts),
        digitalPayouts: money(figures.digitalPayouts),
        shiftAggregateLitres: figures.shiftAggregateLitres.toFixed(3),
        shiftAggregateValue: money(figures.shiftAggregateValue),
        transactionLitres: figures.transactionLitres.toFixed(3),
      },
      history: shapeAll(history),
      note:
        'Expected cash and digital collections are derived from recorded transactions, receipts, expenses and payouts. ' +
        'Credit sales are excluded from cash until a receipt is recorded. Totalizer-only shift totals have no payment-mode ' +
        'split and are therefore shown separately as aggregate estimates.',
    });
  }),
);

financeRouter.post(
  '/reconciliation',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reconciliation.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        cashCounted: z.union([z.string(), z.number()]).transform(String),
        digitalSettled: z.union([z.string(), z.number()]).transform(String).optional(),
        notes: z.string().max(500).optional().nullable(),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    const figures = buildExpectations(station.id, body.businessDate);
    const cashCounted = D(body.cashCounted);
    const digitalSettled = D(body.digitalSettled ?? 0);
    const variance = cashCounted.plus(digitalSettled).minus(figures.cash).minus(figures.digital);
    const existing = get<{ id: string; status: string }>(
      "SELECT id, status FROM reconciliations WHERE station_id = ? AND business_date = ? AND type = 'CASH'",
      [station.id, body.businessDate],
    );
    if (existing) throw conflict('A reconciliation already exists for this business date — approve or adjust the existing record');
    const id = newId('rec');
    const status = variance.abs().lte(1) ? 'BALANCED' : 'VARIANCE';
    run(
      `INSERT INTO reconciliations
        (id, tenant_id, station_id, business_date, type, cash_expected, cash_counted, digital_expected,
         digital_settled, variance, status, notes, created_by, created_at)
       VALUES (?, ?, ?, ?, 'CASH', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, station.tenant_id, station.id, body.businessDate, money(figures.cash), money(cashCounted),
        money(figures.digital), money(digitalSettled), money(variance), status, body.notes ?? null,
        auth.user.id, nowIso()],
    );
    audit(req, {
      action: 'RECONCILIATION_RECORDED', entity: 'Reconciliation', entityId: id, stationId: station.id,
      summary: `${body.businessDate}: cash ${money(cashCounted)} vs expected ${money(figures.cash)} (variance ${money(variance)})`,
      after: { status, variance: money(variance) },
    });
    return created(res, shape(get('SELECT * FROM reconciliations WHERE id = ?', [id])));
  }),
);

financeRouter.post(
  '/reconciliation/:id/approve',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'reconciliation.write')) throw forbidden();
    const record = get<Record<string, unknown>>('SELECT * FROM reconciliations WHERE id = ? AND tenant_id = ?', [
      req.params.id, tenantIdOf(auth),
    ]);
    if (!record) throw notFound('Reconciliation not found');
    getStationOrThrow(auth, String(record.station_id));
    if (record.status === 'APPROVED') throw conflict('Reconciliation is already approved');
    const body = parse(z.object({ note: z.string().max(500).optional().nullable() }), req.body ?? {});
    run("UPDATE reconciliations SET status = 'APPROVED', approved_by = ?, approved_at = ?, notes = COALESCE(?, notes) WHERE id = ?", [
      auth.user.id, nowIso(), body.note ?? null, String(record.id),
    ]);
    audit(req, {
      action: 'RECONCILIATION_APPROVED', entity: 'Reconciliation', entityId: String(record.id),
      stationId: String(record.station_id),
      summary: `Variance ${money(D(record.variance as string))} approved${body.note ? `: ${body.note}` : ''}`,
    });
    return ok(res, shape(get('SELECT * FROM reconciliations WHERE id = ?', [String(record.id)])));
  }),
);
