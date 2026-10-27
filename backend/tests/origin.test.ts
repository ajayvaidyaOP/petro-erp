import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

let app: Express;

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('E2B_SANDBOX_ID', 'previewtest');
  vi.resetModules();
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('preview session cookies', () => {
  it('sets and clears secure partitioned cookies for an embedded HTTPS preview', async () => {
    const host = '5173-sandbox.e2b.app';
    const origin = `https://${host}`;
    const login = await request(app).post('/api/v1/auth/login')
      .set('Host', host).set('Origin', origin)
      .send({ email: 'owner@sunrisefuels.in', password: 'PetroFlow@2025' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(/SameSite=None/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Partitioned/i);
    const value = cookie.split(';')[0]!;
    expect((await request(app).get('/api/v1/auth/me').set('Host', host).set('Cookie', value)).status).toBe(200);
    const logout = await request(app).post('/api/v1/auth/logout').set('Host', host)
      .set('Origin', origin).set('Cookie', value).send({});
    expect(logout.status).toBe(200);
    expect(logout.headers['set-cookie'][0]).toMatch(/Partitioned/i);
    expect((await request(app).get('/api/v1/auth/me').set('Host', host).set('Cookie', value)).status).toBe(401);
  });

  it('keeps ordinary localhost session cookies SameSite=Lax', async () => {
    const login = await request(app).post('/api/v1/auth/login').set('Origin', 'http://localhost:5173')
      .send({ email: 'owner@sunrisefuels.in', password: 'PetroFlow@2025' });
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie'][0] as string;
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Partitioned/i);
  });
});

describe('development origin protection', () => {
  it('allows local and this sandbox’s genuine preview origins', async () => {
    const cases = [
      { origin: 'http://localhost:5173', host: 'localhost:4000' },
      { origin: 'https://5173-sandbox.e2b.app', host: '5173-sandbox.e2b.app' },
      // Some reverse proxies replace the Host header with a local address.
      { origin: 'https://5173-previewtest.e2b.app', host: 'localhost:5173' },
    ];
    for (const { origin, host } of cases) {
      const res = await request(app).post('/api/v1/auth/login').set('Origin', origin).set('Host', host).send({});
      // The origin passed the guard; the empty credentials fail validation.
      expect(res.status).toBe(422);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
  });

  it('rejects unrelated and spoofed preview origins, including other sandboxes', async () => {
    for (const origin of ['https://attacker.example', 'https://e2b.app.attacker.example', 'https://other-sandbox.e2b.app']) {
      const res = await request(app).post('/api/v1/auth/login').set('Host', '5173-sandbox.e2b.app').set('Origin', origin).send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BAD_ORIGIN');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});
