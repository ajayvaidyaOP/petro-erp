import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.js';
import { all, get, run } from '../db/index.js';
import { forbidden, unauthorized } from './errors.js';
import { addHoursIso, nowIso } from './time.js';
import { sha256, verifyPassword } from './security.js';
import { newId } from './ids.js';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  roleKey: string;
  roleName: string;
  tenantId: string | null;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  isDemo: boolean;
}

export interface AuthContext {
  user: PublicUser;
  sessionId: string;
  tenantId: string | null;
  permissions: Set<string>;
  roleScope: string;
  isSuperAdmin: boolean;
  /** True for tenant-wide roles (owner) — station scoping is not applied. */
  allStations: boolean;
  stationIds: Set<string>;
}

function permissionsOfRole(roleKey: string): string[] {
  const row = get<{ permissions: string; scope: string }>('SELECT permissions, scope FROM roles WHERE key = ?', [roleKey]);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.permissions);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function roleScopeOf(roleKey: string): string {
  return get<{ scope: string }>('SELECT scope FROM roles WHERE key = ?', [roleKey])?.scope ?? 'STATION';
}

export function publicUser(userId: string): PublicUser | null {
  const row = get<Record<string, unknown>>(
    `SELECT u.id, u.email, u.name, u.role_key, u.tenant_id, u.status, u.must_change_password,
            u.last_login_at, u.is_demo, r.name AS role_name
       FROM users u LEFT JOIN roles r ON r.key = u.role_key
      WHERE u.id = ?`,
    [userId],
  );
  if (!row) return null;
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    roleKey: String(row.role_key),
    roleName: (row.role_name as string) ?? String(row.role_key),
    tenantId: (row.tenant_id as string | null) ?? null,
    status: String(row.status),
    mustChangePassword: Number(row.must_change_password) === 1,
    lastLoginAt: (row.last_login_at as string | null) ?? null,
    isDemo: Number(row.is_demo) === 1,
  };
}

export function authenticatePassword(email: string, password: string) {
  const row = get<Record<string, unknown>>('SELECT * FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!row) return null;
  if (String(row.status) !== 'ACTIVE') return null;
  if (!verifyPassword(password, String(row.password_hash))) return null;
  return row;
}

export function createSession(userId: string, meta: { ip?: string | null; userAgent?: string | null }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = addHoursIso(nowIso(), env.SESSION_TTL_HOURS);
  run(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip, user_agent, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [newId('ses'), userId, sha256(token), expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 300) ?? null, nowIso(), nowIso()],
  );
  return { token, expiresAt, sessionId: null as string | null };
}

export function revokeSession(sessionId: string) {
  run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [nowIso(), sessionId]);
}

export function revokeUserSessions(userId: string) {
  run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [nowIso(), userId]);
}

function buildContext(userId: string, sessionId: string): AuthContext | null {
  const user = publicUser(userId);
  if (!user || user.status !== 'ACTIVE') return null;
  const scope = roleScopeOf(user.roleKey);
  const permissions = new Set(permissionsOfRole(user.roleKey));
  const access = user.tenantId
    ? all<{ station_id: string; permissions: string }>(
        'SELECT station_id, permissions FROM user_station_access WHERE user_id = ?',
        [user.id],
      )
    : [];
  for (const row of access) {
    try {
      const extra = JSON.parse(row.permissions);
      if (Array.isArray(extra)) for (const perm of extra) permissions.add(String(perm));
    } catch {
      /* ignore malformed override list */
    }
  }
  const isSuperAdmin = user.roleKey === 'SUPER_ADMIN';
  return {
    user,
    sessionId,
    tenantId: user.tenantId,
    permissions,
    roleScope: scope,
    isSuperAdmin,
    allStations: scope === 'TENANT',
    stationIds: new Set(access.map((row) => row.station_id)),
  };
}

/** Resolve the session cookie (if any) without rejecting anonymous requests. */
export function attachAuth(req: Request, _res: Response, next: NextFunction) {
  req.auth = undefined;
  req.sessionToken = undefined;
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[env.SESSION_COOKIE_NAME];
  if (!token) return next();
  const row = get<Record<string, unknown>>(
    `SELECT s.id, s.user_id, s.expires_at, s.revoked_at, u.status AS user_status,
            u.tenant_id, t.status AS tenant_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (!row || row.revoked_at) return next();
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) return next();
  if (String(row.user_status) !== 'ACTIVE') return next();
  if (row.tenant_id && String(row.tenant_status) !== 'ACTIVE') return next();

  const context = buildContext(String(row.user_id), String(row.id));
  if (!context) return next();
  req.auth = context;
  req.sessionToken = token;
  if (Math.random() < 0.02) {
    run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [nowIso(), String(row.id)]);
  }
  return next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized('Your session has expired — please sign in again'));
  return next();
}

export function requirePlatform(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized('Your session has expired — please sign in again'));
  if (!req.auth.isSuperAdmin) return next(forbidden('Platform administrator access is required'));
  return next();
}

export function requirePermission(permission: string, req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized('Your session has expired — please sign in again'));
  if (!req.auth.permissions.has(permission)) {
    return next(forbidden(`Missing permission: ${permission}`));
  }
  return next();
}

export function can(auth: AuthContext | undefined, permission: string): boolean {
  return Boolean(auth?.permissions.has(permission));
}

export function assertPermission(auth: AuthContext | undefined, permission: string) {
  if (!auth) throw unauthorized();
  if (!auth.permissions.has(permission)) throw forbidden(`Missing permission: ${permission}`);
}

export function tenantOf(auth: AuthContext | undefined): string {
  if (!auth) throw unauthorized();
  if (!auth.tenantId) throw forbidden('This endpoint is only available to organization users');
  return auth.tenantId;
}

export function isSuperAdmin(auth: AuthContext | undefined): boolean {
  return Boolean(auth?.isSuperAdmin);
}
