import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let ownerAgent: ReturnType<typeof request.agent>;
let ownerBAgent: ReturnType<typeof request.agent>;
let cashierAgent: ReturnType<typeof request.agent>;
let operatorAgent: ReturnType<typeof request.agent>;
let stationAId: string;
let stationBId: string;
let shiftId: string;
const PASSWORD = 'PetroFlow@2025';

async function login(email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  const { env } = await import('../src/env.js');
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${env.DATABASE_FILE}${suffix}`)) fs.rmSync(`${env.DATABASE_FILE}${suffix}`);
  }
  const { migrate } = await import('../src/db/index.js');
  migrate();
  const { runSeed } = await import('../src/db/seed.js');
  await runSeed({ force: true });
  const { createApp } = await import('../src/app.js');
  app = createApp();

  ownerAgent = await login('owner@sunrisefuels.in');
  ownerBAgent = await login('owner@highwayenergy.in');
  cashierAgent = await login('cashier@sunrisefuels.in');
  operatorAgent = await login('operator@sunrisefuels.in');

  const me = await ownerAgent.get('/api/v1/auth/me');
  const stations = me.body.data.stations as { id: string; code: string }[];
  stationAId = stations.find((s) => s.code === 'SUN-BAN')!.id;
  stationBId = stations.find((s) => s.code === 'SUN-HIN')!.id;
  const shifts = await ownerAgent.get(`/api/v1/shifts?stationId=${stationAId}&status=OPEN`);
  shiftId = shifts.body.data[0].id;
});

describe('authentication & authorization', () => {
  it('allows development previews to be embedded without dropping other security headers', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects protected endpoints without a session', async () => {
    expect((await request(app).get('/api/v1/catalog/stations')).status).toBe(401);
    expect((await request(app).get('/api/v1/reports/owner-dashboard?stationId=x')).status).toBe(401);
  });

  it('rejects invalid credentials and sets no session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'owner@sunrisefuels.in', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('returns the camelCase demo account contract used by the login screen', async () => {
    const res = await request(app).get('/api/v1/auth/demo-accounts');
    expect(res.status).toBe(200);
    const owner = res.body.data.accounts.find((account: { email: string }) => account.email === 'owner@sunrisefuels.in');
    expect(owner).toMatchObject({ roleKey: 'OWNER', tenantName: 'Sunrise Fuels Pvt Ltd' });
    expect(res.body.data.warning).toContain('local evaluation');
  });

  it('rate-limits credential attempts without locking out session reads or logout', async () => {
    const { createApp } = await import('../src/app.js');
    const { env } = await import('../src/env.js');
    const isolatedApp = createApp();
    const agent = request.agent(isolatedApp);
    // Successful sign-ins must not consume the failed-credential allowance,
    // even when the same browser/network signs in repeatedly.
    for (let i = 0; i < env.LOGIN_RATE_LIMIT_MAX + 1; i += 1) {
      expect((await agent.post('/api/v1/auth/login').send({ email: 'owner@sunrisefuels.in', password: PASSWORD })).status).toBe(200);
    }
    for (let i = 0; i < env.LOGIN_RATE_LIMIT_MAX; i += 1) {
      expect((await agent.post('/api/v1/auth/login').send({})).status).toBe(422);
    }
    expect((await agent.post('/api/v1/auth/login').send({})).status).toBe(429);
    expect((await agent.get('/api/v1/auth/demo-accounts')).status).toBe(200);
    for (let i = 0; i < 25; i += 1) {
      expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
    }
    expect((await agent.post('/api/v1/auth/logout').send({})).status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('returns the authenticated profile with permissions', async () => {
    const res = await ownerAgent.get('/api/v1/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('owner@sunrisefuels.in');
    expect(res.body.data.permissions).toContain('shifts.close');
    expect(res.body.data.tenant.name).toContain('Sunrise');
  });

  it('blocks station staff from platform administration', async () => {
    const res = await ownerAgent.get('/api/v1/admin/metrics');
    expect(res.status).toBe(403);
  });

  it('enforces permission boundaries for cashier and operator roles', async () => {
    const product = await cashierAgent.post('/api/v1/catalog/products').send({
      code: 'HACK', name: 'Unauthorised product', category: 'PETROL',
    });
    expect(product.status).toBe(403);

    const approve = await operatorAgent.post(`/api/v1/shifts/${shiftId}/approve`).send({});
    expect(approve.status).toBe(403);

    const read = await operatorAgent.get('/api/v1/shifts');
    expect(read.status).toBe(200);
  });

  it('allows the platform super admin to reach admin metrics only with a valid session', async () => {
    const admin = await login('superadmin@petroflow.dev');
    const res = await admin.get('/api/v1/admin/metrics');
    expect(res.status).toBe(200);
    expect(res.body.data.tenants.total).toBeGreaterThanOrEqual(2);
    // Platform metrics must not leak tenant fuel revenue ledgers.
    expect(JSON.stringify(res.body.data)).not.toContain('total_litres');
  });
});

describe('tenant isolation', () => {
  it('does not allow another tenant to read a station dashboard by id', async () => {
    const res = await ownerBAgent.get(`/api/v1/reports/owner-dashboard?stationId=${stationAId}`);
    expect([403, 404]).toContain(res.status);
  });

  it('does not allow another tenant to list a station’s shifts', async () => {
    const res = await ownerBAgent.get(`/api/v1/shifts?stationId=${stationAId}`);
    expect([403, 404]).toContain(res.status);
  });

  it('scopes tenant lists to owned records', async () => {
    const res = await ownerBAgent.get('/api/v1/catalog/stations');
    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((s) => s.id);
    expect(ids).not.toContain(stationAId);
    expect(ids).toContain((await ownerBAgent.get('/api/v1/auth/me')).body.data.stations[0].id);
  });

  it('keeps unfiltered station-owned catalog lists within the owner’s tenant', async () => {
    for (const resource of ['tanks', 'dispensers', 'nozzles']) {
      const own = await ownerAgent.get(`/api/v1/catalog/${resource}`);
      const other = await ownerBAgent.get(`/api/v1/catalog/${resource}`);
      expect(own.status).toBe(200);
      expect(other.status).toBe(200);
      expect(other.body.data.length).toBeGreaterThan(0);
      const ownIds = new Set(own.body.data.map((row: { id: string }) => row.id));
      for (const row of other.body.data) expect(ownIds.has(row.id)).toBe(false);
    }
  });

  it('creates station-owned tanks, dispensers and nozzles without a tenant_id column', async () => {
    const products = await ownerAgent.get('/api/v1/catalog/products');
    const productId = products.body.data[0].id as string;
    const tank = await ownerAgent.post('/api/v1/catalog/tanks').send({
      stationId: stationBId, code: 'T-REG', name: 'Regression tank', productId, capacityLitres: '1000',
    });
    expect(tank.status, JSON.stringify(tank.body)).toBe(201);
    const dispenser = await ownerAgent.post('/api/v1/catalog/dispensers').send({
      stationId: stationBId, code: 'D-REG', name: 'Regression dispenser', serialNumber: 'SER-REG',
    });
    expect(dispenser.status, JSON.stringify(dispenser.body)).toBe(201);
    const nozzle = await ownerAgent.post('/api/v1/catalog/nozzles').send({
      stationId: stationBId, dispenserId: dispenser.body.data.id, productId, number: 1, label: 'Regression nozzle',
    });
    expect(nozzle.status, JSON.stringify(nozzle.body)).toBe(201);
  });

  it('blocks cross-tenant meter reading access', async () => {
    const res = await ownerBAgent.get(`/api/v1/readings?stationId=${stationAId}`);
    expect([403, 404]).toContain(res.status);
  });

  it('prevents cashier from opening a shift at an unauthorised station', async () => {
    const res = await cashierAgent.post('/api/v1/shifts').send({ stationId: stationBId });
    expect(res.status).toBe(403);
  });

  it('scopes overdue shift alerts to the selected and authorized station', async () => {
    const { all, run } = await import('../src/db/index.js');
    const open = all<{ id: string; opened_at: string }>(
      "SELECT id, opened_at FROM shifts WHERE station_id IN (?, ?) AND status = 'OPEN'", [stationAId, stationBId],
    );
    try {
      for (const shift of open) run('UPDATE shifts SET opened_at = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', shift.id]);
      for (const id of [stationAId, stationBId]) {
        const res = await ownerAgent.get(`/api/v1/shifts/alerts?stationId=${id}`);
        expect(res.status).toBe(200);
        expect(res.body.data.count).toBeGreaterThan(0);
        expect(res.body.data.alerts.every((row: { stationId: string }) => row.stationId === id)).toBe(true);
      }
      expect((await cashierAgent.get(`/api/v1/shifts/alerts?stationId=${stationBId}`)).status).toBe(403);
    } finally {
      for (const shift of open) run('UPDATE shifts SET opened_at = ? WHERE id = ?', [shift.opened_at, shift.id]);
    }
  });

  it('does not include other stations in unfiltered hardware diagnostics', async () => {
    const manager = await login('manager@sunrisefuels.in');
    const allAccessible = await manager.get('/api/v1/hardware/diagnostics');
    const selected = await manager.get(`/api/v1/hardware/diagnostics?stationId=${stationAId}`);
    expect(allAccessible.status).toBe(200);
    expect(allAccessible.body.data.devices.every((device: { stationId: string }) => device.stationId === stationAId)).toBe(true);
    expect(allAccessible.body.data.eventCounts).toEqual(selected.body.data.eventCounts);
    expect(allAccessible.body.data.qualityCounts).toEqual(selected.body.data.qualityCounts);
    expect((await manager.get(`/api/v1/hardware/diagnostics?stationId=${stationBId}`)).status).toBe(403);
  });
});

describe('hardware ingestion & idempotency', () => {
  it('preserves device mode and never treats a disabled gateway as online', async () => {
    const created = await ownerAgent.post('/api/v1/devices').send({
      stationId: stationAId, code: 'GW-REAL-TEST', name: 'Unverified real controller', type: 'CONTROLLER', isSimulated: false,
    });
    expect(created.status).toBe(201);
    expect(created.body.data.type).toBe('CONTROLLER');
    expect(created.body.data.isSimulated).toBe(0);
    expect(created.body.data.apiKeyHash).toBeUndefined();
    const id = created.body.data.id as string;
    const simulate = await ownerAgent.post('/api/v1/demo/simulate').send({ stationId: stationAId, deviceId: id });
    expect(simulate.status).toBe(422);

    const { run } = await import('../src/db/index.js');
    run('UPDATE hardware_devices SET last_heartbeat_at = ? WHERE id = ?', [new Date().toISOString(), id]);
    const disabled = await ownerAgent.patch(`/api/v1/devices/${id}`).send({ status: 'DISABLED' });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.online).toBe(false);
  });

  it('authenticates gateways with device keys and deduplicates events', async () => {
    const created = await ownerAgent.post('/api/v1/devices').send({
      stationId: stationAId, code: 'GW-TEST-IDEMP', name: 'Idempotency Gateway', isSimulated: true,
    });
    expect(created.status).toBe(201);
    const apiKey = created.body.data.apiKey as string;
    expect(apiKey).toMatch(/^pfk_/);

    const event = {
      eventId: 'IDEMP-EVT-1',
      type: 'TOTALIZER_SNAPSHOT',
      sequence: 500,
      occurredAt: new Date().toISOString(),
      dispenserCode: 'D1',
      nozzleNumber: 1,
      value: '999999.000',
      unit: 'L',
    };

    const first = await request(app)
      .post('/api/v1/gateway/events')
      .set('x-device-key', apiKey)
      .send({ events: [event] });
    expect(first.status).toBe(200);
    expect(first.body.data.accepted).toBe(1);
    expect(first.body.data.results[0].quality).toBe('SUSPICIOUS');
    expect(first.body.data.results[0].countable).toBe(false);

    const before = await ownerAgent.get(`/api/v1/readings?stationId=${stationAId}&pageSize=100`);
    const countBefore = before.body.meta.total as number;

    const second = await request(app)
      .post('/api/v1/gateway/events')
      .set('x-device-key', apiKey)
      .send({ events: [event] });
    expect(second.body.data.duplicates).toBe(1);
    expect(second.body.data.accepted).toBe(0);

    const after = await ownerAgent.get(`/api/v1/readings?stationId=${stationAId}&pageSize=100`);
    expect(after.body.meta.total).toBe(countBefore);

    const rejectedKey = await request(app)
      .post('/api/v1/gateway/events')
      .set('x-device-key', 'pfk_000000000000_invalidinvalidinvalid')
      .send({ events: [event] });
    expect(rejectedKey.status).toBe(401);
  });

  it('rejects negative manual readings and records valid fallback entries', async () => {
    const nozzle = await ownerAgent.get(`/api/v1/catalog/nozzles?stationId=${stationAId}`);
    const nozzleId = nozzle.body.data[0].id as string;
    const bad = await ownerAgent
      .post('/api/v1/readings/manual')
      .send({ nozzleId, readingValue: '-5', unit: 'L' });
    expect(bad.status).toBe(422);
    const good = await ownerAgent
      .post('/api/v1/readings/manual')
      .send({ nozzleId, readingValue: '12345.678', unit: 'L', note: 'Manual fallback test' });
    expect(good.status).toBe(201);
    expect(good.body.data.source).toBe('MANUAL');
  });
});

describe('shift operations', () => {
  it('closes a shift with consistent totalizer arithmetic and blocks double close', async () => {
    const detail = await ownerAgent.get(`/api/v1/shifts/${shiftId}`);
    expect(detail.status).toBe(200);
    const nozzles = detail.body.data.nozzles as Record<string, unknown>[];

    const closed = await ownerAgent.post(`/api/v1/shifts/${shiftId}/close`).send({ closingCash: '18000' });
    expect(closed.status).toBe(200);
    expect(['CLOSED', 'FLAGGED']).toContain(closed.body.data.status);

    for (const nozzle of closed.body.data.nozzles as Record<string, unknown>[]) {
      if (nozzle.litresSold !== null && nozzle.openingReading && nozzle.closingReading) {
        const expected =
          Number(nozzle.closingReading) - Number(nozzle.openingReading) + Number(nozzle.adjustmentLitres ?? 0);
        expect(Number(nozzle.litresSold)).toBeCloseTo(expected, 3);
      }
    }

    const again = await ownerAgent.post(`/api/v1/shifts/${shiftId}/close`).send({});
    expect(again.status).toBe(409);
  });

  it('records shift readings via manual entry with an audit trail', async () => {
    // The demo seed keeps an open shift at every outlet (a real forecourt is
    // always mid-shift). Reuse it when present, otherwise open a new one.
    const openShifts = await ownerAgent.get(`/api/v1/shifts?stationId=${stationBId}&status=OPEN`);
    const existingShift = (openShifts.body.data as { id: string }[])[0];
    const opened = existingShift
      ? await ownerAgent.get(`/api/v1/shifts/${existingShift.id}`)
      : await ownerAgent
          .post('/api/v1/shifts')
          .send({ stationId: stationBId, openingCash: '5000', captureReadings: false });
    expect(opened.status).toBe(existingShift ? 200 : 201);
    const newShiftId = opened.body.data.id as string;
    const nozzleId = opened.body.data.nozzles[0].nozzleId as string;

    const updated = await ownerAgent
      .patch(`/api/v1/shifts/${newShiftId}/nozzles/${nozzleId}`)
      .send({ openingReading: '1000.000', closingReading: '1150.500' });
    expect(updated.status).toBe(200);
    const nozzle = (updated.body.data.nozzles as Record<string, unknown>[])[0];
    expect(nozzle.litresSold).toBe('150.500');

    const audit = await ownerAgent.get(`/api/v1/audit?stationId=${stationBId}&search=SHIFT_NOZZLE`);
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);

    const preview = await ownerAgent.post(`/api/v1/shifts/${newShiftId}/capture`).send({});
    expect(preview.status).toBe(200);
    const previewNozzle = preview.body.data.preview.find((row: { nozzleId: string }) => row.nozzleId === nozzleId);
    expect(previewNozzle.closing).toBe('1150.500');
    expect(previewNozzle.litres).toBe('150.500');
    expect((await ownerAgent.get(`/api/v1/shifts/${newShiftId}`)).body.data.status).toBe('OPEN');

    const invalid = await ownerAgent.patch(`/api/v1/shifts/${newShiftId}/nozzles/${nozzleId}`)
      .send({ closingReading: '-1' });
    expect(invalid.status).toBe(422);
    const badAdjustment = await ownerAgent.patch(`/api/v1/shifts/${newShiftId}/nozzles/${nozzleId}`)
      .send({ adjustmentLitres: '-2' });
    expect(badAdjustment.status).toBe(422);
    const unknown = await ownerAgent.post(`/api/v1/shifts/${newShiftId}/close`)
      .send({ readings: [{ nozzleId: 'unknown-nozzle', reading: '123' }] });
    expect(unknown.status).toBe(422);

    const secondNozzleId = opened.body.data.nozzles[1].nozzleId as string;
    const adjusted = await ownerAgent.patch(`/api/v1/shifts/${newShiftId}/nozzles/${secondNozzleId}`)
      .send({ openingReading: '1000', closingReading: '1010', adjustmentLitres: '-100', adjustmentReason: 'Test correction' });
    expect(adjusted.status).toBe(200);
    const negativePreview = await ownerAgent.post(`/api/v1/shifts/${newShiftId}/capture`).send({});
    const flagged = negativePreview.body.data.preview.find((row: { nozzleId: string }) => row.nozzleId === secondNozzleId);
    expect(flagged.status).toBe('FLAGGED');
    expect(flagged.litres).toBeNull();

    const closed = await ownerAgent.post(`/api/v1/shifts/${newShiftId}/close`).send({});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const savedNozzle = closed.body.data.nozzles.find((row: { nozzleId: string }) => row.nozzleId === nozzleId);
    expect(savedNozzle.closingReading).toBe('1150.500');
    expect(savedNozzle.closingSource).toBe('MANUAL');
    expect(savedNozzle.litresSold).toBe('150.500');
    const savedFlagged = closed.body.data.nozzles.find((row: { nozzleId: string }) => row.nozzleId === secondNozzleId);
    expect(savedFlagged.status).toBe('FLAGGED');
    expect(savedFlagged.litresSold).toBeNull();
  });
});

describe('shift reversal and stock allocation', () => {
  it('reverses the original tank movements even when the tank configuration changes', async () => {
    const { all } = await import('../src/db/index.js');
    const closed = await ownerAgent.get(`/api/v1/shifts?stationId=${stationAId}&status=CLOSED`);
    const id = closed.body.data[0].id as string;
    const original = all<{ tank_id: string; product_id: string; quantity_litres: string }>(
      "SELECT tank_id, product_id, quantity_litres FROM stock_movements WHERE reference_type = 'SHIFT' AND reference_id = ? AND type = 'DISPENSED'",
      [id],
    );
    expect(original.length).toBeGreaterThan(0);
    const extraTank = await ownerAgent.post('/api/v1/catalog/tanks').send({
      stationId: stationAId, code: 'T-REVERSAL', name: 'Added after close', productId: original[0]!.product_id, capacityLitres: '500000',
    });
    expect(extraTank.status).toBe(201);
    const opening = await ownerAgent.post('/api/v1/inventory/opening-stock').send({
      tankId: extraTank.body.data.id, litres: '100000',
    });
    expect(opening.status).toBe(201);

    const reversed = await ownerAgent.post(`/api/v1/shifts/${id}/reverse`).send({ reason: 'Reversal regression test' });
    expect(reversed.status).toBe(200);
    const offsets = all<{ tank_id: string; product_id: string; quantity_litres: string }>(
      "SELECT tank_id, product_id, quantity_litres FROM stock_movements WHERE reference_type = 'SHIFT_REVERSAL' AND reference_id = ?",
      [id],
    );
    expect(offsets.length).toBe(original.length);
    for (const movement of original) {
      expect(offsets).toContainEqual({
        tank_id: movement.tank_id,
        product_id: movement.product_id,
        quantity_litres: (-Number(movement.quantity_litres)).toFixed(3),
      });
    }
    expect(offsets.some((movement) => movement.tank_id === extraTank.body.data.id)).toBe(false);
    expect((await ownerAgent.post(`/api/v1/shifts/${id}/reverse`).send({ reason: 'Second reversal attempt' })).status).toBe(409);
  });

  it('allocates tiny multi-tank volumes exactly to ledger precision', async () => {
    const { allocateAcrossTanks } = await import('../src/lib/stock.js');
    const { D } = await import('../src/lib/decimal.js');
    const product = await ownerAgent.post('/api/v1/catalog/products').send({ code: 'ROUND', name: 'Rounding test fuel' });
    expect(product.status).toBe(201);
    for (let i = 0; i < 4; i += 1) {
      const tank = await ownerAgent.post('/api/v1/catalog/tanks').send({
        stationId: stationBId, code: `ROUND-${i}`, name: `Rounding tank ${i}`, productId: product.body.data.id, capacityLitres: '1000',
      });
      expect(tank.status).toBe(201);
    }
    const allocations = allocateAcrossTanks(stationBId, product.body.data.id, D('0.002'));
    expect(allocations).toHaveLength(4);
    expect(allocations.every((allocation) => allocation.litres.gte(0))).toBe(true);
    const postedTotal = allocations.reduce((sum, allocation) => sum.plus(D(allocation.litres.toFixed(3))), D(0));
    expect(postedTotal.toFixed(3)).toBe('0.002');
  });
});

describe('financial integrity', () => {
  it('applies idempotency keys to payments so retries do not duplicate money', async () => {
    const customers = await ownerAgent.get('/api/v1/catalog/customers');
    const customerId = customers.body.data[0].id as string;
    const key = 'test-idem-payment-0001';
    const payload = {
      stationId: stationAId,
      direction: 'RECEIPT',
      partyType: 'CUSTOMER',
      customerId,
      amount: '1250.00',
      mode: 'CASH',
      reference: 'IDEM-CASH-001',
    };
    const first = await ownerAgent.post('/api/v1/finance/payments').set('Idempotency-Key', key).send(payload);
    expect(first.status).toBe(201);
    const second = await ownerAgent.post('/api/v1/finance/payments').set('Idempotency-Key', key).send(payload);
    expect(second.status).toBe(201);
    expect(second.body.data.paymentId).toBe(first.body.data.paymentId);

    const list = await ownerAgent.get('/api/v1/finance/payments?reference=IDEM-CASH-001');
    expect(list.status).toBe(200);
    expect(list.body.data.filter((p: { reference: string }) => p.reference === 'IDEM-CASH-001')).toHaveLength(1);
  });

  it('rejects a credit sale beyond the customer credit limit', async () => {
    const customers = await ownerAgent.get('/api/v1/catalog/customers');
    const customer = (customers.body.data as Record<string, unknown>[])[0];
    const res = await ownerAgent.post('/api/v1/finance/credit-sales').send({
      stationId: stationAId,
      customerId: customer.id,
      amount: '9999999',
      paymentMode: 'CREDIT',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toContain('Credit limit');
  });

  it('keeps stock ledger consistent: opening + receipts − dispensed = book stock', async () => {
    const res = await ownerAgent.get(`/api/v1/inventory/stock?stationId=${stationAId}`);
    expect(res.status).toBe(200);
    for (const tank of res.body.data.tanks) {
      const book = Number(tank.bookStockLitres);
      expect(Number.isFinite(book)).toBe(true);
    }
    const ledger = await ownerAgent.get(`/api/v1/inventory/tanks/${res.body.data.tanks[0].id}/ledger`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.data.closingBookStock).toBe(res.body.data.tanks[0].bookStockLitres);
  });
});

describe('query parameter validation', () => {
  // Regression: junk date filters used to reach Date.UTC() and surface as HTTP 500
  // (plus a platform_errors row) instead of a client error.
  it('rejects invalid date filters with 422 instead of failing with 500', async () => {
    const cases = [
      `/api/v1/finance/expenses?stationId=${stationAId}&from=garbage&to=nonsense`,
      `/api/v1/finance/payments?stationId=${stationAId}&from=garbage&to=nonsense`,
      '/api/v1/audit?from=garbage&to=nonsense',
      `/api/v1/finance/expenses?stationId=${stationAId}&from=2026-99-99&to=2026-10-27`,
      `/api/v1/finance/expenses?stationId=${stationAId}&from=2026-02-30`,
    ];
    for (const path of cases) {
      const res = await ownerAgent.get(path);
      expect(res.status, `${path} should not 500`).toBe(422);
      expect(res.body.error.code).toBe('UNPROCESSABLE');
    }
  });

  it('still accepts valid ISO date filters', async () => {
    const res = await ownerAgent.get(
      `/api/v1/finance/expenses?stationId=${stationAId}&from=2026-10-01&to=2026-10-27`,
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.expenses)).toBe(true);
  });

  it('treats blank date filters as "no filter"', async () => {
    const res = await ownerAgent.get(`/api/v1/finance/expenses?stationId=${stationAId}&from=&to=`);
    expect(res.status).toBe(200);
  });

  it('ends the 14-day dashboard trend on the selected business date', async () => {
    const res = await ownerAgent.get(`/api/v1/reports/owner-dashboard?stationId=${stationAId}&date=2026-02-28`);
    expect(res.status).toBe(200);
    expect(res.body.data.trend).toHaveLength(14);
    expect(res.body.data.trend[0].date).toBe('02-15');
    expect(res.body.data.trend[13].date).toBe('02-28');
    expect((await ownerAgent.get(`/api/v1/reports/owner-dashboard?stationId=${stationAId}&date=2026-02-30`)).status).toBe(400);
  });
});
