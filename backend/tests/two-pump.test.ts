import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let owner: ReturnType<typeof request.agent>;
let staff1: ReturnType<typeof request.agent>;
let staff2: ReturnType<typeof request.agent>;
let stations: { id: string; name: string; code: string }[];
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

beforeAll(async () => {
  const { env } = await import('../src/env.js');
  for (const suffix of ['', '-wal', '-shm']) if (fs.existsSync(`${env.DATABASE_FILE}${suffix}`)) fs.rmSync(`${env.DATABASE_FILE}${suffix}`);
  const { migrate } = await import('../src/db/index.js');
  migrate();
  const { runSeed } = await import('../src/db/seed.js');
  await runSeed();
  const { createApp } = await import('../src/app.js');
  app = createApp();
  async function login(email: string) {
    const agent = request.agent(app);
    expect((await agent.post('/api/v1/auth/login').send({ email, password: 'PetroFlow@2025' })).status).toBe(200);
    return agent;
  }
  owner = await login('owner@sunrisefuels.in');
  staff1 = await login('staff1@sunrisefuels.in');
  staff2 = await login('staff2@sunrisefuels.in');
  stations = (await owner.get('/api/v1/auth/me')).body.data.stations;
});

describe('two-pump client setup', () => {
  it('seeds exactly three client accounts and two stations, without exposing platform login', async () => {
    const demo = await request(app).get('/api/v1/auth/demo-accounts');
    expect(demo.body.data.accounts.map((u: { email: string }) => u.email).sort()).toEqual(['owner@sunrisefuels.in', 'staff1@sunrisefuels.in', 'staff2@sunrisefuels.in']);
    expect(stations).toHaveLength(2);
    const me = await staff1.get('/api/v1/auth/me');
    expect(me.body.data.stations).toHaveLength(1);
    expect(me.body.data.stations[0].code).toBe('SUN-BAN');
  });

  it('denies the other pump and owner-only features to staff', async () => {
    const other = stations.find((s) => s.code === 'SUN-HIN')!;
    for (const path of [`/catalog/tanks?stationId=${other.id}`, `/shifts?stationId=${other.id}`, `/inventory/stock?stationId=${other.id}`, `/density?stationId=${other.id}`, `/attendance?stationId=${other.id}&date=${today()}`, `/catalog/prices?stationId=${other.id}`]) {
      expect((await staff1.get(`/api/v1${path}`)).status, path).toBe(403);
    }
    for (const path of ['/reports/combined-dashboard', '/reports/ageing', '/reports/export/ageing.csv', '/finance/customer-statement?customerId=x&month=2026-10', '/finance/supplier-ledger?supplierId=x']) {
      expect((await staff1.get(`/api/v1${path}`)).status, path).toBe(403);
    }
    expect((await staff1.post('/api/v1/shifts/day-close/reopen').send({})).status).toBe(403);
    expect((await staff1.post('/api/v1/catalog/employees').send({})).status).toBe(403);
    expect((await staff1.post('/api/v1/catalog/prices').send({})).status).toBe(403);
    const employees = await staff1.get('/api/v1/catalog/employees');
    expect(JSON.stringify(employees.body)).not.toContain('staff2@sunrisefuels.in');
  });

  it('keeps one customer balance across both pumps while labelling owner ledger entries', async () => {
    const customers = await owner.get('/api/v1/catalog/customers');
    const customer = customers.body.data[0];
    const one = stations.find((s) => s.code === 'SUN-BAN')!;
    const two = stations.find((s) => s.code === 'SUN-HIN')!;
    for (const [agent, station] of [[staff1, one], [staff2, two]] as const) {
      const sale = await agent.post('/api/v1/finance/credit-sales').send({ stationId: station.id, customerId: customer.id, amount: '1.00' });
      expect(sale.status).toBe(201);
    }
    const ledger = await owner.get(`/api/v1/finance/customer-ledger?customerId=${customer.id}`);
    expect(ledger.status).toBe(200);
    const lines = ledger.body.data.ledger;
    expect(lines.some((l: { stationName: string }) => l.stationName === one.name)).toBe(true);
    expect(lines.some((l: { stationName: string }) => l.stationName === two.name)).toBe(true);
    expect(Number(ledger.body.data.closingBalance)).toBeCloseTo(Number(customer.balance) + 2, 2);
    expect((await staff1.get(`/api/v1/finance/customer-ledger?customerId=${customer.id}`)).status).toBe(403);
  });

  it('closes both pumps and combined dashboard matches the two station totals', async () => {
    for (const [agent, code] of [[staff1, 'SUN-BAN'], [staff2, 'SUN-HIN']] as const) {
      const station = stations.find((s) => s.code === code)!;
      const list = await agent.get(`/api/v1/shifts?stationId=${station.id}&status=OPEN`);
      const shiftId = list.body.data[0].id;
      const capture = await agent.post(`/api/v1/shifts/${shiftId}/capture`).send({});
      expect(capture.status).toBe(200);
      const close = await agent.post(`/api/v1/shifts/${shiftId}/close`).send({ denominations: [{ denomination: 500, count: 2 }], settlements: [{ mode: 'UPI', received: '0' }] });
      expect(close.status, JSON.stringify(close.body)).toBe(200);
    }
    const combined = (await owner.get(`/api/v1/reports/combined-dashboard?date=${today()}`)).body.data;
    const individual = await Promise.all(stations.map((s) => owner.get(`/api/v1/reports/owner-dashboard?stationId=${s.id}&date=${today()}`)));
    expect(Number(combined.totalValue)).toBeCloseTo(individual.reduce((a, r) => a + Number(r.body.data.sales.shiftValue), 0), 2);
    expect(Number(combined.totalLitres)).toBeCloseTo(individual.reduce((a, r) => a + Number(r.body.data.sales.shiftLitres), 0), 3);
    expect(combined.stations).toHaveLength(2);
    for (const slug of ['sales-register', 'stock-statement']) {
      const csv = await owner.get(`/api/v1/reports/export/${slug}.csv?stationId=all&month=${today().slice(0, 7)}`);
      expect(csv.status).toBe(200);
      expect(csv.text).toContain('Pump');
    }
  });
});
