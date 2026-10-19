import type { Request } from 'express';
import { run } from '../db/index.js';
import { newId } from './ids.js';
import { nowIso } from './time.js';
import { logger } from './logger.js';

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
  tenantId?: string | null;
  stationId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  isDemo?: boolean;
}

function json(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    const text = JSON.stringify(value);
    return text.length > 8000 ? `${text.slice(0, 8000)}…` : text;
  } catch {
    return null;
  }
}

/**
 * Append an audit record. Auditing must never break a business transaction, so
 * failures are logged rather than rethrown.
 */
export function audit(req: Request | null, input: AuditInput) {
  const auth = req?.auth;
  try {
    run(
      `INSERT INTO audit_logs
        (id, tenant_id, station_id, actor_id, actor_email, actor_role, action, entity, entity_id,
         summary, before_data, after_data, ip, user_agent, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('aud'),
        input.tenantId ?? auth?.tenantId ?? null,
        input.stationId ?? null,
        input.actorId ?? auth?.user.id ?? null,
        input.actorEmail ?? auth?.user.email ?? null,
        input.actorRole ?? auth?.user.roleKey ?? null,
        input.action,
        input.entity,
        input.entityId ?? null,
        input.summary ?? null,
        json(input.before),
        json(input.after),
        req?.ip ?? null,
        req?.header('user-agent')?.slice(0, 300) ?? null,
        input.isDemo ? 1 : 0,
        nowIso(),
      ],
    );
  } catch (error) {
    logger.warn({ err: error, action: input.action, entity: input.entity }, 'Failed to write audit log');
  }
}
