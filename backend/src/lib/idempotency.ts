import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { get, run } from '../db/index.js';
import { conflict } from './errors.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import { tenantIdOf } from './tenant.js';
import type { AuthContext } from './auth.js';

export interface IdempotentOutcome<T> {
  status: number;
  data: T;
  replayed: boolean;
}

/**
 * Execute a mutating operation at most once per (tenant, scope, key).
 *
 * Financial endpoints (credit sales, payments, expenses) require an
 * `Idempotency-Key` header so a retried request cannot duplicate money.
 * Reuse with a different payload is rejected with 409.
 */
export function idempotent<T>(
  req: Request,
  auth: AuthContext,
  scope: string,
  fn: () => T,
  successStatus = 201,
): IdempotentOutcome<T> {
  const key = req.header('idempotency-key')?.trim();
  if (!key) {
    return { status: successStatus, data: fn(), replayed: false };
  }
  if (key.length < 8 || key.length > 200) {
    throw conflict('Idempotency-Key must be between 8 and 200 characters');
  }
  const tenantId = tenantIdOf(auth);
  const requestHash = createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
  const existing = get<Record<string, unknown>>(
    'SELECT * FROM idempotency_keys WHERE tenant_id = ? AND scope = ? AND key = ?',
    [tenantId, scope, key],
  );
  if (existing) {
    if (String(existing.request_hash) !== requestHash) {
      throw conflict('This Idempotency-Key was already used with a different payload');
    }
    return {
      status: Number(existing.response_status ?? successStatus),
      data: JSON.parse(String(existing.response_body ?? '{}')) as T,
      replayed: true,
    };
  }
  const data = fn();
  run(
    `INSERT INTO idempotency_keys
      (id, tenant_id, scope, key, request_hash, status, response_status, response_body, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?)`,
    [newId('idk'), tenantId, scope, key, requestHash, successStatus, JSON.stringify(data),
      nowIso(), new Date(Date.now() + 7 * 86_400_000).toISOString()],
  );
  return { status: successStatus, data, replayed: false };
}
