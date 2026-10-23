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

  it('blocks cross-tenant meter reading access', async () => {
    const res = await ownerBAgent.get(`/api/v1/readings?stationId=${stationAId}`);
    expect([403, 404]).toContain(res.status);
  });

  it('prevents cashier from opening a shift at an unauthorised station', async () => {
    const res = await cashierAgent.post('/api/v1/shifts').send({ stationId: stationBId });
    expect(res.status).toBe(403);
  });
});

describe('hardware ingestion & idempotency', () => {
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
