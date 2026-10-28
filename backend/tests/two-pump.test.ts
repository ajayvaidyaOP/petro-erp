import fs from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;
let owner: ReturnType<typeof request.agent>;
let manager: ReturnType<typeof request.agent>;
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
  manager = await login('manager@sunrisefuels.in');
  stations = (await owner.get('/api/v1/auth/me')).body.data.stations;
});

describe('two-pump client setup', () => {
  it('seeds exactly one owner and one manager for two pumps', async () => {
    const demo = await request(app).get('/api/v1/auth/demo-accounts');
    expect(demo.body.data.accounts.map((u: { email: string }) => u.email).sort()).toEqual(['manager@sunrisefuels.in', 'owner@sunrisefuels.in']);
    expect(stations).toHaveLength(2);
    const me = await manager.get('/api/v1/auth/me');
    expect(me.body.data.stations).toHaveLength(2);
  });

  it('keeps setup owner-only while the manager can work at both pumps', async () => {
    const other = stations.find((s) => s.code === 'SUN-HIN')!;
    for (const path of [`/catalog/tanks?stationId=${other.id}`, `/shifts?stationId=${other.id}`, `/inventory/stock?stationId=${other.id}`, `/density?stationId=${other.id}`, `/attendance?stationId=${other.id}&date=${today()}`, `/catalog/prices?stationId=${other.id}`]) {
      expect((await manager.get(`/api/v1${path}`)).status, path).toBe(200);
    }
    expect((await manager.get('/api/v1/reports/combined-dashboard')).status).toBe(403);
    expect((await manager.post('/api/v1/catalog/employees').send({})).status).toBe(403);
    expect((await manager.post('/api/v1/catalog/prices').send({})).status).toBe(403);
    expect((await manager.get('/api/v1/catalog/employees')).status).toBe(403);
    const roles = await owner.get('/api/v1/catalog/roles');
    expect(roles.body.data.map((role: { key: string }) => role.key)).toEqual(['OWNER', 'MANAGER']);
  });

  it('keeps one customer balance across both pumps while labelling owner ledger entries', async () => {
    const customers = await owner.get('/api/v1/catalog/customers');
    const customer = customers.body.data[0];
    const one = stations.find((s) => s.code === 'SUN-BAN')!;
    const two = stations.find((s) => s.code === 'SUN-HIN')!;
    for (const [agent, station] of [[manager, one], [manager, two]] as const) {
      const sale = await agent.post('/api/v1/finance/credit-sales').send({ stationId: station.id, customerId: customer.id, amount: '1.00' });
      expect(sale.status).toBe(201);
    }
    const ledger = await owner.get(`/api/v1/finance/customer-ledger?customerId=${customer.id}`);
    expect(ledger.status).toBe(200);
    const lines = ledger.body.data.ledger;
    expect(lines.some((l: { stationName: string }) => l.stationName === one.name)).toBe(true);
    expect(lines.some((l: { stationName: string }) => l.stationName === two.name)).toBe(true);
    expect(Number(ledger.body.data.closingBalance)).toBeCloseTo(Number(customer.balance) + 2, 2);
    expect((await manager.get(`/api/v1/finance/customer-ledger?customerId=${customer.id}`)).status).toBe(200);
  });

  it('closes both pumps and combined dashboard matches the two station totals', async () => {
    for (const [agent, code] of [[manager, 'SUN-BAN'], [manager, 'SUN-HIN']] as const) {
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
    const month = today().slice(0, 7);
    const monthRows = await import('../src/db/index.js').then(({ all }) => all<{ total_value: string }>(
      "SELECT total_value FROM shifts WHERE business_date >= ? AND business_date <= ? AND status IN ('CLOSED','FLAGGED')",
      [`${month}-01`, today()],
    ));
    const expectedMonth = monthRows.reduce((sum, row) => sum + Number(row.total_value), 0);
    expect(Number(combined.monthValue)).toBeCloseTo(expectedMonth, 2);
    expect(Number(combined.monthValue)).toBeCloseTo(combined.stations.reduce((sum: number, row: { monthValue: string }) => sum + Number(row.monthValue), 0), 2);
    for (const slug of ['sales-register', 'stock-statement']) {
      const csv = await owner.get(`/api/v1/reports/export/${slug}.csv?stationId=all&month=${today().slice(0, 7)}`);
      expect(csv.status).toBe(200);
      expect(csv.text).toContain('Pump');
    }
  });
});


describe('two-role access consolidation', () => {
  it('preserves history while retiring surplus accounts and revoking their sessions', async () => {
    const { all, get, run } = await import('../src/db/index.js');
    const { syncRoles } = await import('../src/db/seed.js');
    const { createSession } = await import('../src/lib/auth.js');
    const tenantId = (await owner.get('/api/v1/auth/me')).body.data.tenant.id as string;
    const original = all<{ id: string; role_key: string }>(
      "SELECT id, role_key FROM users WHERE tenant_id = ? AND status = 'ACTIVE'", [tenantId],
    );
    const passwordHash = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [original[0].id])!.password_hash;
    // Simulate an older database before the partial unique index existed.
    run('DROP INDEX idx_one_active_role_per_tenant');
    run(`INSERT INTO roles (id, key, name, permissions, scope, is_system) VALUES ('rol_legacy_staff', 'STAFF', 'Legacy staff', '["shifts.read"]', 'STATION', 1)`);
    const extras = [
      { id: 'usr_extra_owner', email: 'extra-owner@test.invalid', role: 'OWNER' },
      { id: 'usr_extra_manager', email: 'extra-manager@test.invalid', role: 'MANAGER' },
      { id: 'usr_legacy_staff', email: 'legacy-staff@test.invalid', role: 'STAFF' },
    ];
    for (const user of extras) {
      run(`INSERT INTO users (id, tenant_id, email, name, password_hash, role_key, status, created_at, updated_at)
        VALUES (?, ?, ?, 'Legacy test account', ?, ?, 'ACTIVE', '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')`,
      [user.id, tenantId, user.email, passwordHash, user.role]);
      createSession(user.id, {});
    }
    syncRoles();
    syncRoles(); // Boot/seed retries must not duplicate audit entries.
    const active = all<{ id: string }>("SELECT id FROM users WHERE tenant_id = ? AND status = 'ACTIVE'", [tenantId]);
    expect(active.map((row) => row.id).sort()).toEqual(original.map((row) => row.id).sort());
    for (const user of extras) {
      const row = get<{ status: string; role_key: string }>('SELECT status, role_key FROM users WHERE id = ?', [user.id])!;
      expect(row.status).toBe('DISABLED');
      expect(row.role_key).toBe(user.role);
      expect(get<{ count: number }>('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NULL', [user.id])!.count).toBe(0);
      expect(get<{ count: number }>("SELECT COUNT(*) AS count FROM audit_logs WHERE entity_id = ? AND action = 'TEAM_ACCESS_CONSOLIDATED'", [user.id])!.count).toBe(1);
    }
    expect(JSON.parse(get<{ permissions: string }>("SELECT permissions FROM roles WHERE key = 'STAFF'")!.permissions)).toEqual([]);
    expect(() => run(`INSERT INTO users (id, tenant_id, email, name, password_hash, role_key, status, created_at, updated_at)
      VALUES ('usr_blocked_duplicate', ?, 'blocked@test.invalid', 'Blocked', ?, 'OWNER', 'ACTIVE', '2099-01-01', '2099-01-01')`, [tenantId, passwordHash])).toThrow(/UNIQUE/);
    const team = await owner.get('/api/v1/catalog/employees');
    expect(team.body.data).toHaveLength(2);
    expect(team.body.data.map((row: { roleKey: string }) => row.roleKey).sort()).toEqual(['MANAGER', 'OWNER']);
  });

  it('rejects duplicate seats, role changes and an unassigned manager', async () => {
    const team = (await owner.get('/api/v1/catalog/employees')).body.data as { id: string; roleKey: string }[];
    const ownerId = team.find((row) => row.roleKey === 'OWNER')!.id;
    const managerId = team.find((row) => row.roleKey === 'MANAGER')!.id;
    const duplicate = await owner.post('/api/v1/catalog/employees').send({ name: 'Another owner', email: 'another@test.invalid', password: 'PetroFlow@2025', roleKey: 'OWNER', stationIds: [stations[0].id] });
    expect(duplicate.status).toBe(409);
    expect((await owner.post('/api/v1/catalog/employees').send({ name: 'Another manager', email: 'another-m@test.invalid', password: 'PetroFlow@2025', roleKey: 'MANAGER', stationIds: [stations[0].id] })).status).toBe(409);
    expect((await owner.patch(`/api/v1/catalog/employees/${managerId}`).send({ roleKey: 'OWNER' })).status).toBe(422);
    expect((await owner.patch(`/api/v1/catalog/employees/${managerId}`).send({ stationIds: [] })).status).toBe(422);
    expect((await owner.patch(`/api/v1/catalog/employees/${ownerId}`).send({ status: 'DISABLED' })).status).toBe(422);
  });

  it('cannot elevate a manager through legacy station permission overrides', async () => {
    const { run, get } = await import('../src/db/index.js');
    const me = (await manager.get('/api/v1/auth/me')).body.data;
    const id = me.user.id as string;
    const previous = get<{ permissions: string }>('SELECT permissions FROM user_station_access WHERE user_id = ? AND station_id = ?', [id, stations[0].id])!.permissions;
    try {
      run('UPDATE user_station_access SET permissions = ? WHERE user_id = ? AND station_id = ?', [JSON.stringify(['settings.write', 'employees.write', 'prices.write', 'platform.manage']), id, stations[0].id]);
      const elevated = (await manager.get('/api/v1/auth/me')).body.data;
      for (const permission of ['settings.write', 'employees.write', 'prices.write', 'platform.manage']) expect(elevated.permissions).not.toContain(permission);
      expect((await manager.post('/api/v1/catalog/prices').send({})).status).toBe(403);
      expect((await manager.get('/api/v1/catalog/employees')).status).toBe(403);
    } finally {
      run('UPDATE user_station_access SET permissions = ? WHERE user_id = ? AND station_id = ?', [previous, id, stations[0].id]);
    }
  });
});
