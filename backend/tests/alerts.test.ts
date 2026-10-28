import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Every actionable alert must link to a real workflow screen in the web app.
const KNOWN_ROUTES = new Set(['/shifts', '/tanks', '/devices', '/compliance', '/deliveries', '/finance', '/customers', '/reports', '/density', '/readings']);
const PASSWORD = 'PetroFlow@2025';

let app: Express;
let owner: ReturnType<typeof request.agent>;
let stationId: string;

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

describe('dashboard alert navigation', () => {
  it('attaches a known workflow route to every owner-dashboard alert', async () => {
    const res = await owner.get(`/api/v1/reports/owner-dashboard?stationId=${stationId}`);
    expect(res.status).toBe(200);
    const alerts = res.body.data.alerts as { level: string; message: string; to?: string }[];
    expect(Array.isArray(alerts)).toBe(true);
    for (const alert of alerts) {
      expect(['info', 'warning', 'error']).toContain(alert.level);
      expect(typeof alert.message).toBe('string');
      expect(alert.to, `alert without route: ${alert.message}`).toBeTruthy();
      expect(KNOWN_ROUTES.has(alert.to!), `unknown route ${alert.to}`).toBe(true);
    }
  });

  it('keeps the original alert fields unchanged for existing consumers', async () => {
    const res = await owner.get(`/api/v1/reports/owner-dashboard?stationId=${stationId}`);
    expect(res.body.data).toHaveProperty('alerts');
    expect(res.body.data).toHaveProperty('flaggedShifts');
    expect(res.body.data).toHaveProperty('disclaimer');
  });
});
