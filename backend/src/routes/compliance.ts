import { Router } from 'express';
import { z } from 'zod';
import { COMPLIANCE_DOC_TYPES } from '@petroflow/shared';
import { all, get, run, shape } from '../db/index.js';
import { asyncHandler, created, ok, parse } from '../lib/http.js';
import { forbidden, notFound, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso, todayIst, addDays, isIsoDate } from '../lib/time.js';

export const complianceRouter = Router();
complianceRouter.use(requireAuth);

const docSchema = z.object({
  stationId: z.string().min(3),
  dispenserId: z.string().min(3).optional().nullable(),
  tankId: z.string().min(3).optional().nullable(),
  docType: z.enum(COMPLIANCE_DOC_TYPES),
  title: z.string().min(2).max(120),
  docNumber: z.string().max(80).optional().nullable(),
  authority: z.string().max(80).optional().nullable(),
  issuedOn: z.string().refine(isIsoDate, 'YYYY-MM-DD chahiye').optional().nullable(),
  expiresOn: z.string().refine(isIsoDate, 'YYYY-MM-DD chahiye'),
  renewalLeadDays: z.coerce.number().int().min(1).max(180).optional(),
  notes: z.string().max(500).optional().nullable(),
});

function withStatus(row: Record<string, unknown>) {
  const today = todayIst();
  const expires = String(row.expires_on);
  const lead = Number(row.renewal_lead_days ?? 30);
  const daysLeft = Math.round((new Date(`${expires}T12:00:00+05:30`).getTime() - new Date(`${today}T12:00:00+05:30`).getTime()) / 86_400_000);
  const status = daysLeft < 0 ? 'EXPIRED' : daysLeft <= lead ? 'EXPIRING' : 'OK';
  return { ...shape(row), daysLeft, status };
}

function loadDoc(auth: AuthContext, id: string) {
  const doc = get<Record<string, unknown>>('SELECT * FROM compliance_documents WHERE id = ? AND tenant_id = ?', [
    id, tenantIdOf(auth),
  ]);
  if (!doc) throw notFound('Compliance document not found');
  getStationOrThrow(auth, String(doc.station_id));
  return doc;
}

complianceRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'compliance.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    if (!stationId) throw unprocessable('stationId is required');
    const station = getStationOrThrow(auth, stationId);
    const rows = all(
      `SELECT c.*, d.code AS dispenser_code, t.code AS tank_code
         FROM compliance_documents c
         LEFT JOIN dispensers d ON d.id = c.dispenser_id
         LEFT JOIN tanks t ON t.id = c.tank_id
        WHERE c.station_id = ?
        ORDER BY c.expires_on ASC`,
      [station.id],
    );
    const docs = rows.map((row) => withStatus(row as Record<string, unknown>));
    return ok(res, {
      documents: docs,
      summary: {
        expired: docs.filter((d) => d.status === 'EXPIRED').length,
        expiring: docs.filter((d) => d.status === 'EXPIRING').length,
        ok: docs.filter((d) => d.status === 'OK').length,
      },
    });
  }),
);

complianceRouter.post(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'compliance.write')) throw forbidden();
    const body = parse(docSchema, req.body);
    const station = getStationOrThrow(auth, body.stationId);
    if (body.dispenserId) {
      const dispenser = get('SELECT id FROM dispensers WHERE id = ? AND station_id = ?', [body.dispenserId, station.id]);
      if (!dispenser) throw unprocessable('Dispenser is station par nahi hai');
    }
    if (body.tankId) {
      const tank = get('SELECT id FROM tanks WHERE id = ? AND station_id = ?', [body.tankId, station.id]);
      if (!tank) throw unprocessable('Tank is station par nahi hai');
    }
    const id = newId('cmp');
    run(
      `INSERT INTO compliance_documents
        (id, tenant_id, station_id, dispenser_id, tank_id, doc_type, title, doc_number, authority,
         issued_on, expires_on, renewal_lead_days, notes, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, tenantIdOf(auth), station.id, body.dispenserId ?? null, body.tankId ?? null, body.docType, body.title,
        body.docNumber ?? null, body.authority ?? null, body.issuedOn ?? null, body.expiresOn,
        body.renewalLeadDays ?? 30, body.notes ?? null, nowIso(), nowIso()],
    );
    audit(req, {
      action: 'COMPLIANCE_DOC_ADDED', entity: 'ComplianceDocument', entityId: id, stationId: station.id,
      summary: `${body.title} (${body.docType}) — expires ${body.expiresOn}`,
    });
    return created(res, withStatus(get<Record<string, unknown>>('SELECT * FROM compliance_documents WHERE id = ?', [id])!));
  }),
);

complianceRouter.patch(
  '/:id',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'compliance.write')) throw forbidden();
    const doc = loadDoc(auth, req.params.id);
    const body = parse(docSchema.partial().omit({ stationId: true }), req.body);
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    const map: [keyof typeof body, string][] = [
      ['dispenserId', 'dispenser_id'], ['tankId', 'tank_id'], ['docType', 'doc_type'], ['title', 'title'],
      ['docNumber', 'doc_number'], ['authority', 'authority'], ['issuedOn', 'issued_on'],
      ['expiresOn', 'expires_on'], ['renewalLeadDays', 'renewal_lead_days'], ['notes', 'notes'],
    ];
    for (const [key, column] of map) {
      if (body[key] !== undefined) { sets.push(`${column} = ?`); params.push(body[key] as string | number | null); }
    }
    if (sets.length === 0) throw unprocessable('Badalne ke liye koi field nahi diya');
    run(`UPDATE compliance_documents SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...params, nowIso(), String(doc.id)]);
    audit(req, {
      action: 'COMPLIANCE_DOC_UPDATED', entity: 'ComplianceDocument', entityId: String(doc.id), stationId: String(doc.station_id),
      summary: `${String(doc.title)} updated`,
      before: doc as Record<string, unknown>, after: body as Record<string, unknown>,
    });
    return ok(res, withStatus(get<Record<string, unknown>>('SELECT * FROM compliance_documents WHERE id = ?', [String(doc.id)])!));
  }),
);

complianceRouter.delete(
  '/:id',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'compliance.write')) throw forbidden();
    const doc = loadDoc(auth, req.params.id);
    run('DELETE FROM compliance_documents WHERE id = ?', [String(doc.id)]);
    audit(req, {
      action: 'COMPLIANCE_DOC_DELETED', entity: 'ComplianceDocument', entityId: String(doc.id), stationId: String(doc.station_id),
      summary: `${String(doc.title)} deleted`,
      before: doc as Record<string, unknown>,
    });
    return ok(res, { deleted: true });
  }),
);

/** Dashboard alerts ke liye: agle `withinDays` me expire hone wale documents. */
export function complianceAlerts(stationId: string) {
  const soon = addDays(todayIst(), 45);
  const rows = all<Record<string, unknown>>(
    `SELECT c.*, d.code AS dispenser_code, t.code AS tank_code
       FROM compliance_documents c
       LEFT JOIN dispensers d ON d.id = c.dispenser_id
       LEFT JOIN tanks t ON t.id = c.tank_id
      WHERE c.station_id = ? AND c.expires_on <= ?
      ORDER BY c.expires_on ASC LIMIT 5`,
    [stationId, soon],
  );
  return rows.map((row) => {
    const shaped = shape(row) as Record<string, unknown>;
    const daysLeft = Math.round(
      (new Date(`${String(row.expires_on)}T12:00:00+05:30`).getTime() - new Date(`${todayIst()}T12:00:00+05:30`).getTime()) / 86_400_000,
    );
    const what = shaped.dispenserCode ? ` (${String(shaped.dispenserCode)})` : shaped.tankCode ? ` (${String(shaped.tankCode)})` : '';
    return {
      level: daysLeft < 0 ? 'error' : 'warning',
      message: daysLeft < 0
        ? `Compliance EXPIRED: ${String(shaped.title)}${what} ${Math.abs(daysLeft)} din pehle khatm ho gaya — turant renew karo.`
        : `Compliance expiry najdeek: ${String(shaped.title)}${what} ${daysLeft} din me expire hoga (${String(shaped.expiresOn)}).`,
    };
  });
}

