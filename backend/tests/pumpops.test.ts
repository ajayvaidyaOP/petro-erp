import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { densityAt15C, evaluateDensity } from '../src/lib/density.js';

let app: Express;
let owner: ReturnType<typeof request.agent>;
let stationId: string;
const PASSWORD = 'PetroFlow@2025';

function istDate(daysAgo: number) {
  const now = new Date(Date.now() + 5.5 * 3_600_000 - daysAgo * 86_400_000);
  return now.toISOString().slice(0, 10);
}

beforeAll(async () => {
  const { env } = await import('../src/env.js');
  for (const suffix of ['', '-wal', '-shm']) {
    if (fs.existsSync(`${env.DATABASE_FILE}${suffix}`)) fs.rmSync(`${env.DATABASE_FILE}${suffix}`);
  }
  const { migrate } = await import('../src/db/index.js');
  migrate();
  const { runSeed } = await import('../src/db/seed.js');
  await runSeed({ force: true, legacyTestFixtures: true });
  const { createApp } = await import('../src/app.js');
  app = createApp();
  owner = request.agent(app);
  const res = await owner.post('/api/v1/auth/login').send({ email: 'owner@sunrisefuels.in', password: PASSWORD });
  expect(res.status).toBe(200);
  const me = await owner.get('/api/v1/auth/me');
  stationId = (me.body.data.stations as { id: string; code: string }[]).find((s) => s.code === 'SUN-BAN')!.id;
});

describe('density correction (15°C)', () => {
  it('corrects petrol density upward when fuel is warm', () => {
    // 738.4 kg/m³ at 31°C → 738.4 + 0.70 × 16 = 749.6
    expect(densityAt15C('PETROL', '738.4', '31').toFixed(1)).toBe('749.6');
  });

  it('flags out-of-spec diesel', () => {
    const result = evaluateDensity('DIESEL', '870', '30');
    expect(result.withinSpec).toBe(false);
  });

  it('records a density check end-to-end', async () => {
    const tanks = await owner.get(`/api/v1/catalog/tanks?stationId=${stationId}&pageSize=5`);
    expect(tanks.status).toBe(200);
    const tankId = tanks.body.data[0].id as string;
    const created = await owner.post('/api/v1/density').send({
      stationId, tankId, observedDensity: '738.4', observedTempC: '31', businessDate: istDate(0),
    });
    expect(created.status).toBe(201);
    expect(created.body.data.densityAt15c).toBe('749.6');
    expect(created.body.data.withinSpec).toBe(1);
    const list = await owner.get(`/api/v1/density?stationId=${stationId}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
  });
});

describe('compliance', () => {
  it('reports seeded expired + expiring documents', async () => {
    const res = await owner.get(`/api/v1/compliance?stationId=${stationId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.expired).toBeGreaterThanOrEqual(1);
    expect(res.body.data.summary.expiring).toBeGreaterThanOrEqual(1);
  });
});

describe('lubricants', () => {
  it('tracks stock and blocks over-selling', async () => {
    const list = await owner.get(`/api/v1/lubricants/products?stationId=${stationId}`);
    expect(list.status).toBe(200);
    const product = (list.body.data as { id: string; stockQty: string }[])[0]!;
    const before = Number(product.stockQty);
    expect(before).toBeGreaterThan(2);

    const sale = await owner.post('/api/v1/lubricants/movements').send({
      stationId, productId: product.id, type: 'SALE', quantity: '3', paymentMode: 'CASH',
    });
    expect(sale.status).toBe(201);

    const after = await owner.get(`/api/v1/lubricants/products?stationId=${stationId}`);
    const updated = (after.body.data as { id: string; stockQty: string }[]).find((p) => p.id === product.id)!;
    expect(Number(updated.stockQty)).toBe(before - 3);

    const overSale = await owner.post('/api/v1/lubricants/movements').send({
      stationId, productId: product.id, type: 'SALE', quantity: '99999', paymentMode: 'CASH',
    });
    expect(overSale.status).toBe(422);
  });
});

describe('day closing (roznamcha)', () => {
  it('locks a closed business date and reopens with a reason', async () => {
    const yesterday = istDate(1);
    const close = await owner.post('/api/v1/shifts/day-close').send({ stationId, businessDate: yesterday });
    expect(close.status).toBe(201);

    const blocked = await owner.post('/api/v1/shifts').send({ stationId, businessDate: yesterday });
    expect(blocked.status).toBe(409);
    expect(JSON.stringify(blocked.body)).toMatch(/closed/i);

    const reopen = await owner.post('/api/v1/shifts/day-close/reopen').send({
      stationId, businessDate: yesterday, reason: 'Ek credit slip reh gayi thi, sudharna hai',
    });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.status).toBe('REOPENED');
  });
});

describe('shift testing + settlement', () => {
  it('nets testing litres and records denominations', async () => {
    const shifts = await owner.get(`/api/v1/shifts?stationId=${stationId}&status=OPEN`);
    expect(shifts.status).toBe(200);
    const shiftId = shifts.body.data[0].id as string;

    const detail = await owner.get(`/api/v1/shifts/${shiftId}`);
    const nozzleId = detail.body.data.nozzleReadings[0].nozzleId as string;

    const patched = await owner.patch(`/api/v1/shifts/${shiftId}/nozzles/${nozzleId}`).send({ testingLitres: '5' });
    expect(patched.status).toBe(200);

    const preview = await owner.post(`/api/v1/shifts/${shiftId}/capture`).send({});
    expect(preview.status).toBe(200);
    const firstPreview = (preview.body.data.preview as { nozzleId: string; litres: string | null; grossLitres: string | null; testingLitres: string }[])
      .find((row) => row.nozzleId === nozzleId)!;
    expect(firstPreview.testingLitres).toBe('5.000');
    if (firstPreview.litres !== null && firstPreview.grossLitres !== null) {
      expect(Number(firstPreview.grossLitres) - Number(firstPreview.litres)).toBeCloseTo(5, 3);
    }

    const closed = await owner.post(`/api/v1/shifts/${shiftId}/close`).send({
      denominations: [
        { denomination: 500, count: 2 },
        { denomination: 100, count: 3 },
      ],
      settlements: [{ mode: 'UPI', received: '0' }],
      notes: 'Pump ops test close',
    });
    expect(closed.status).toBe(200);
    expect(closed.body.data.cashCounted).toBe('1300.00');
    expect((closed.body.data.denominations as unknown[]).length).toBe(2);
    expect((closed.body.data.settlements as unknown[]).length).toBeGreaterThan(0);
    expect(closed.body.data.totals.testingLitres).toBe('5.000');
  });
});
