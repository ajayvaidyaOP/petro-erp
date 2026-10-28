import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { all, get, run, shape, shapeAll } from '../db/index.js';
import { asyncHandler, ok, parse } from '../lib/http.js';
import { conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import {
  attachAuth,
  authenticatePassword,
  createSession,
  publicUser,
  requireAuth,
  revokeSession,
  type AuthContext,
} from '../lib/auth.js';
import { assertPasswordStrength, hashPassword, verifyPassword } from '../lib/security.js';
import { audit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';
import { isDevelopmentPreviewRequest } from '../lib/preview.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

function cookieScope(req: Request) {
  // Arena's HTTPS preview runs inside a cross-site iframe. Lax cookies are not
  // sent there, so a successful login would immediately lose its session. CHIPS
  // keeps the preview cookie isolated to its embedding site even when browsers
  // block ordinary third-party cookies. Production/local cookies remain Lax.
  const isPreview = isDevelopmentPreviewRequest(req);
  return {
    httpOnly: true,
    sameSite: isPreview ? 'none' as const : 'lax' as const,
    secure: isPreview || env.COOKIE_SECURE,
    partitioned: isPreview,
    path: '/',
  };
}

function cookieOptions(req: Request, expiresAt: string) {
  return { ...cookieScope(req), expires: new Date(expiresAt) };
}

authRouter.post(
  '/login',
  asyncHandler((req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const row = authenticatePassword(email, password);
    if (!row) throw unauthorized('Invalid email or password');
    if (!['OWNER', 'MANAGER', 'SUPER_ADMIN'].includes(String(row.role_key))) {
      throw forbidden('This account uses a retired role. Ask the owner to set up the manager account.');
    }
    const tenantId = (row.tenant_id as string | null) ?? null;
    if (tenantId) {
      const tenant = get<{ status: string }>('SELECT status FROM tenants WHERE id = ?', [tenantId]);
      if (!tenant || tenant.status !== 'ACTIVE') {
        throw forbidden('This organization is suspended. Contact your platform administrator.');
      }
      const subscription = get<{ status: string; ends_at: string | null }>(
        'SELECT status, ends_at FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1',
        [tenantId],
      );
      if (subscription && subscription.status === 'CANCELLED') {
        throw forbidden('The subscription for this organization has been cancelled');
      }
    }
    const session = createSession(String(row.id), { ip: req.ip, userAgent: req.header('user-agent') });
    // The dev fallback token is in the JSON body; never let intermediaries cache it.
    res.setHeader('Cache-Control', 'no-store');
    res.cookie(env.SESSION_COOKIE_NAME, session.token, cookieOptions(req, session.expiresAt));
    run('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso(), String(row.id)]);
    audit(req, {
      action: 'AUTH_LOGIN', entity: 'User', entityId: String(row.id),
      summary: `Login from ${req.ip ?? 'unknown IP'}`, tenantId,
      actorId: String(row.id), actorEmail: String(row.email), actorRole: String(row.role_key),
    });
    const user = publicUser(String(row.id));
    return ok(res, {
      user,
      sessionExpiresAt: session.expiresAt,
      // Development-only fallback for preview/browser environments that reject
      // all cookies. The frontend stores it in tab-scoped sessionStorage.
      ...(env.NODE_ENV === 'development' ? { sessionToken: session.token } : {}),
    });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler((req, res) => {
    if (req.auth) {
      revokeSession(req.auth.sessionId);
      audit(req, { action: 'AUTH_LOGOUT', entity: 'User', entityId: req.auth.user.id });
    }
    res.clearCookie(env.SESSION_COOKIE_NAME, cookieScope(req));
    return ok(res, { loggedOut: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    const user = publicUser(auth.user.id);
    if (!user) throw unauthorized('User no longer exists');
    const tenant = auth.tenantId ? shape(get('SELECT * FROM tenants WHERE id = ?', [auth.tenantId])) : null;
    const subscription = auth.tenantId
      ? shape(
          get(
            `SELECT s.*, p.name AS plan_name, p.code AS plan_code, p.features, p.max_stations, p.max_users, p.max_dispensers
               FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
              WHERE s.tenant_id = ? ORDER BY s.created_at DESC LIMIT 1`,
            [auth.tenantId],
          ),
          ['features'],
        )
      : null;
    const stations = auth.tenantId
      ? all(
          `SELECT s.id, s.name, s.code, s.status, s.city, s.state FROM stations s
            WHERE s.tenant_id = ? ${auth.allStations ? '' : 'AND s.id IN (SELECT station_id FROM user_station_access WHERE user_id = ?)'}
            ORDER BY s.name`,
          auth.allStations ? [auth.tenantId] : [auth.tenantId, auth.user.id],
        )
      : [];
    return ok(res, {
      user,
      tenant,
      subscription,
      stations: shapeAll(stations),
      permissions: [...auth.permissions],
      roleScope: auth.roleScope,
      isSuperAdmin: auth.isSuperAdmin,
      demoMode: env.ENABLE_DEMO_TOOLS,
      session: { expiresAt: get<{ expires_at: string }>('SELECT expires_at FROM sessions WHERE id = ?', [auth.sessionId])?.expires_at ?? null },
    });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    const body = parse(
      z.object({
        currentPassword: z.string().min(1).max(200),
        newPassword: z.string().min(10).max(200),
      }),
      req.body,
    );
    const row = get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [auth.user.id]);
    if (!row || !verifyPassword(body.currentPassword, row.password_hash)) {
      throw unauthorized('Current password is incorrect');
    }
    assertPasswordStrength(body.newPassword);
    if (body.currentPassword === body.newPassword) throw conflict('New password must differ from the current password');
    run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', [
      hashPassword(body.newPassword), nowIso(), auth.user.id,
    ]);
    // Keep the current session, revoke every other session.
    run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL', [
      nowIso(), auth.user.id, auth.sessionId,
    ]);
    audit(req, { action: 'PASSWORD_CHANGED', entity: 'User', entityId: auth.user.id, summary: 'Password changed; other sessions revoked' });
    return ok(res, { changed: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    const rows = all(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions
        WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
      [auth.user.id, nowIso()],
    );
    return ok(res, shapeAll(rows).map((row: Record<string, unknown>) => ({ ...row, current: row.id === auth.sessionId })));
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    const session = get<{ id: string; user_id: string }>('SELECT id, user_id FROM sessions WHERE id = ?', [req.params.id]);
    if (!session || session.user_id !== auth.user.id) throw notFound('Session not found');
    if (session.id === auth.sessionId) throw conflict('Use logout to end the current session');
    revokeSession(session.id);
    audit(req, { action: 'SESSION_REVOKED', entity: 'Session', entityId: session.id, summary: 'Session revoked by the user' });
    return ok(res, { revoked: true });
  }),
);

authRouter.get(
  '/demo-accounts',
  attachAuth,
  asyncHandler((_req, res) => {
    if (!env.ENABLE_DEMO_TOOLS) throw notFound('Demo accounts are disabled');
    const rows = all<Record<string, unknown>>(
      `SELECT u.email, u.name, u.role_key, t.name AS tenant_name, t.slug
         FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
        WHERE u.is_demo = 1 AND u.status = 'ACTIVE' AND u.role_key IN ('OWNER', 'MANAGER') ORDER BY CASE u.role_key WHEN 'OWNER' THEN 0 ELSE 1 END, u.email`,
    );
    return ok(res, {
      demoMode: true,
      password: env.DEMO_PASSWORD,
      accounts: rows.map((row) => ({
        email: row.email,
        name: row.name,
        roleKey: row.role_key,
        tenantName: row.tenant_name,
        tenantSlug: row.slug,
      })),
      warning: 'Demo credentials are for local evaluation only. Never enable demo accounts in production.',
    });
  }),
);
