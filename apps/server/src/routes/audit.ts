import { Router } from 'express';
import { all, get, shapeAll } from '../db/index.js';
import { asyncHandler, ok, pageMeta, paging, sortClause } from '../lib/http.js';
import { forbidden } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { tenantIdOf } from '../lib/tenant.js';
import { istDayEnd, istDayStart } from '../lib/time.js';

export const auditRouter = Router();
auditRouter.use(requireAuth);

auditRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'audit.read')) throw forbidden();
    const p = paging(req.query as Record<string, unknown>);
    const clauses = ['tenant_id = ?'];
    const params: (string | number)[] = [tenantIdOf(auth)];
    const stationId = typeof req.query.stationId === 'string' && req.query.stationId ? req.query.stationId : null;
    if (stationId) {
      if (!auth.allStations && !auth.stationIds.has(stationId)) throw forbidden('You do not have access to this station');
      clauses.push('station_id = ?');
      params.push(stationId);
    } else if (!auth.allStations) {
      const ids = [...auth.stationIds];
      clauses.push(`(station_id IS NULL OR station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"}))`);
      params.push(...ids);
    }
    for (const [key, column] of [['entity', 'entity'], ['action', 'action'], ['actorId', 'actor_id']] as const) {
      const value = req.query[key];
      if (typeof value === 'string' && value) { clauses.push(`${column} = ?`); params.push(value); }
    }
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search) {
      clauses.push('(summary LIKE ? OR actor_email LIKE ? OR action LIKE ? OR entity_id LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (typeof req.query.from === 'string' && req.query.from) { clauses.push('created_at >= ?'); params.push(istDayStart(req.query.from)); }
    if (typeof req.query.to === 'string' && req.query.to) { clauses.push('created_at <= ?'); params.push(istDayEnd(req.query.to)); }
    const where = clauses.join(' AND ');
    const order = sortClause(req.query as Record<string, unknown>, { createdAt: 'created_at' }, 'created_at DESC');
    const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM audit_logs WHERE ${where}`, params)?.count ?? 0;
    const rows = all(
      `SELECT * FROM audit_logs WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      [...params, p.pageSize, p.offset],
    );
    const actions = all<{ action: string; count: number }>(
      'SELECT action, COUNT(*) AS count FROM audit_logs WHERE tenant_id = ? GROUP BY action ORDER BY count DESC LIMIT 30',
      [tenantIdOf(auth)],
    );
    return ok(res, shapeAll(rows, ['beforeData', 'afterData']), {
      ...pageMeta(total, p),
      actions: actions.map((a) => ({ action: a.action, count: a.count })),
    });
  }),
);
