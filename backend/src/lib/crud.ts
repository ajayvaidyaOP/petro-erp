import { Router } from 'express';
import { z } from 'zod';
import { all, get, run, shape, shapeAll, toSnake } from '../db/index.js';
import { asyncHandler, created, ok, pageMeta, paging, parse, sortClause } from '../lib/http.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';

export type FieldType = 'string' | 'text' | 'decimal' | 'integer' | 'boolean' | 'date';

export interface CrudField {
  name: string;
  type?: FieldType;
  column?: string;
}

export interface CrudOptions {
  table: string;
  entity: string;
  idPrefix: string;
  fields: (string | CrudField)[];
  tenantScoped?: boolean;
  stationScoped?: boolean;
  searchColumns?: string[];
  sortable?: Record<string, string>;
  defaultSort?: string;
  createSchema: z.ZodTypeAny;
  updateSchema?: z.ZodTypeAny;
  permissions: { read: string; write: string };
  beforeCreate?: (data: Record<string, unknown>, auth: AuthContext) => Record<string, unknown>;
  beforeUpdate?: (
    data: Record<string, unknown>,
    existing: Record<string, unknown>,
    auth: AuthContext,
  ) => Record<string, unknown>;
  afterCreate?: (id: string, auth: AuthContext, data: Record<string, unknown>) => void;
  afterUpdate?: (id: string, auth: AuthContext, data: Record<string, unknown>) => void;
  /** Soft-delete via an is_active flag instead of removing the row. */
  softDelete?: boolean;
  hasUpdatedAt?: boolean;
}

const DECIMAL_FIELDS = new Set<FieldType>(['decimal']);

function normaliseFields(fields: (string | CrudField)[]): Required<CrudField>[] {
  return fields.map((field) => {
    const spec = typeof field === 'string' ? { name: field } : field;
    return {
      name: spec.name,
      type: spec.type ?? 'string',
      column: spec.column ?? toSnake(spec.name),
    };
  });
}

function coerce(name: string, type: FieldType, value: unknown) {
  if (value === undefined || value === null) return null;
  if (type === 'boolean') return value ? 1 : 0;
  if (type === 'decimal') {
    const n = String(value).trim();
    if (!/^-?\d+(\.\d+)?$/.test(n)) throw conflict(`${name} must be a number`);
    return n;
  }
  if (type === 'integer') {
    const n = Number(value);
    if (!Number.isFinite(n)) throw conflict(`${name} must be a whole number`);
    return Math.trunc(n);
  }
  if (type === 'date') return new Date(String(value)).toISOString();
  return String(value);
}

/**
 * Generic, permission-checked CRUD router used for station configuration
 * entities (products, tanks, dispensers, nozzles, suppliers, customers…).
 * Every query is tenant-scoped and, for station-scoped entities, station-scoped.
 */
export function makeCrudRouter(options: CrudOptions): Router {
  const router = Router();
  const fields = normaliseFields(options.fields);
  const byName = new Map(fields.map((f) => [f.name, f]));

  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler((req, res) => {
      const auth = req.auth as AuthContext;
      if (!can(auth, options.permissions.read)) throw forbidden('Permission denied');
      const p = paging(req.query as Record<string, unknown>);
      const clauses: string[] = [];
      const params: (string | number)[] = [];
      if (options.tenantScoped) {
        clauses.push('tenant_id = ?');
        params.push(tenantIdOf(auth));
      }
      if (options.stationScoped) {
        const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
        if (stationId) {
          const station = getStationOrThrow(auth, stationId);
          clauses.push('station_id = ?');
          params.push(station.id);
        } else if (!auth.allStations) {
          const ids = [...auth.stationIds];
          clauses.push(`station_id IN (${ids.length ? ids.map(() => '?').join(',') : "''"})`);
          params.push(...ids);
        }
      }
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      if (search && options.searchColumns?.length) {
        clauses.push(`(${options.searchColumns.map((c) => `${c} LIKE ?`).join(' OR ')})`);
        for (const _ of options.searchColumns) params.push(`%${search}%`);
      }
      if (options.softDelete && req.query.includeInactive !== 'true') {
        clauses.push('is_active = 1');
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const order = sortClause(req.query as Record<string, unknown>, options.sortable ?? {}, options.defaultSort ?? 'created_at DESC');
      const total = get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${options.table} ${where}`, params)?.count ?? 0;
      const rows = all(
        `SELECT * FROM ${options.table} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
        [...params, p.pageSize, p.offset],
      );
      return ok(res, shapeAll(rows), pageMeta(total, p));
    }),
  );

  router.get(
    '/:id',
    asyncHandler((req, res) => {
      const auth = req.auth as AuthContext;
      if (!can(auth, options.permissions.read)) throw forbidden('Permission denied');
      const row = get<Record<string, unknown>>(`SELECT * FROM ${options.table} WHERE id = ?`, [req.params.id]);
      if (!row) throw notFound(`${options.entity} not found`);
      if (options.tenantScoped && row.tenant_id !== tenantIdOf(auth)) throw notFound(`${options.entity} not found`);
      if (options.stationScoped) getStationOrThrow(auth, String(row.station_id));
      return ok(res, shape(row));
    }),
  );

  router.post(
    '/',
    asyncHandler((req, res) => {
      const auth = req.auth as AuthContext;
      if (!can(auth, options.permissions.write)) throw forbidden('Permission denied');
      let data = parse(options.createSchema, req.body) as Record<string, unknown>;
      let tenantIdForInsert: string | null = null;
      if (options.stationScoped) {
        const stationId = String(data.stationId ?? req.body.stationId ?? '');
        const station = getStationOrThrow(auth, stationId);
        data.stationId = station.id;
        tenantIdForInsert = station.tenant_id;
      } else if (options.tenantScoped) {
        tenantIdForInsert = tenantIdOf(auth);
      }
      if (options.beforeCreate) data = options.beforeCreate(data, auth);
      const columns: string[] = [];
      const placeholders: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, value] of Object.entries(data)) {
        const field = byName.get(key);
        if (!field) continue;
        columns.push(field.column);
        placeholders.push('?');
        values.push(coerce(field.name, field.type, value) as string | number | null);
      }
      if (tenantIdForInsert && !columns.includes('tenant_id')) {
        columns.push('tenant_id');
        placeholders.push('?');
        values.push(tenantIdForInsert);
      }
      if (options.hasUpdatedAt) {
        columns.push('created_at', 'updated_at');
        placeholders.push('?', '?');
        values.push(nowIso(), nowIso());
      } else if (columns.includes('created_at')) {
        /* schema supplies its own timestamp */
      } else {
        columns.push('created_at');
        placeholders.push('?');
        values.push(nowIso());
      }
      const id = newId(options.idPrefix);
      columns.unshift('id');
      placeholders.unshift('?');
      values.unshift(id);
      run(
        `INSERT INTO ${options.table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values,
      );
      options.afterCreate?.(id, auth, data);
      const row = get<Record<string, unknown>>(`SELECT * FROM ${options.table} WHERE id = ?`, [id]);
      audit(req, {
        action: `${options.entity.toUpperCase()}_CREATED`,
        entity: options.entity,
        entityId: id,
        stationId: (data.stationId as string | undefined) ?? null,
        summary: `${options.entity} created`,
        after: shape(row),
      });
      return created(res, shape(row));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler((req, res) => {
      const auth = req.auth as AuthContext;
      if (!can(auth, options.permissions.write)) throw forbidden('Permission denied');
      const existing = get<Record<string, unknown>>(`SELECT * FROM ${options.table} WHERE id = ?`, [req.params.id]);
      if (!existing) throw notFound(`${options.entity} not found`);
      if (options.tenantScoped && existing.tenant_id !== tenantIdOf(auth)) throw notFound(`${options.entity} not found`);
      if (options.stationScoped) getStationOrThrow(auth, String(existing.station_id));
      const schema = options.updateSchema ?? options.createSchema;
      let data = parse(schema, req.body) as Record<string, unknown>;
      if (options.beforeUpdate) data = options.beforeUpdate(data, existing, auth);
      const sets: string[] = [];
      const values: (string | number | null)[] = [];
      for (const [key, value] of Object.entries(data)) {
        const field = byName.get(key);
        if (!field || key === 'stationId') continue;
        sets.push(`${field.column} = ?`);
        values.push(coerce(field.name, field.type, value) as string | number | null);
      }
      if (sets.length === 0) return ok(res, shape(existing));
      if (options.hasUpdatedAt) sets.push('updated_at = ?');
      run(`UPDATE ${options.table} SET ${sets.join(', ')} WHERE id = ?`, [
        ...values,
        ...(options.hasUpdatedAt ? [nowIso()] : []),
        String(existing.id),
      ]);
      options.afterUpdate?.(String(existing.id), auth, data);
      const row = get<Record<string, unknown>>(`SELECT * FROM ${options.table} WHERE id = ?`, [String(existing.id)]);
      audit(req, {
        action: `${options.entity.toUpperCase()}_UPDATED`,
        entity: options.entity,
        entityId: String(existing.id),
        stationId: (existing.station_id as string | undefined) ?? null,
        summary: `${options.entity} updated`,
        before: shape(existing),
        after: shape(row),
      });
      return ok(res, shape(row));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler((req, res) => {
      const auth = req.auth as AuthContext;
      if (!can(auth, options.permissions.write)) throw forbidden('Permission denied');
      const existing = get<Record<string, unknown>>(`SELECT * FROM ${options.table} WHERE id = ?`, [req.params.id]);
      if (!existing) throw notFound(`${options.entity} not found`);
      if (options.tenantScoped && existing.tenant_id !== tenantIdOf(auth)) throw notFound(`${options.entity} not found`);
      if (options.stationScoped) getStationOrThrow(auth, String(existing.station_id));
      if (options.softDelete) {
        run(`UPDATE ${options.table} SET is_active = 0${options.hasUpdatedAt ? ', updated_at = ?' : ''} WHERE id = ?`, [
          ...(options.hasUpdatedAt ? [nowIso()] : []),
          String(existing.id),
        ]);
      } else {
        run(`DELETE FROM ${options.table} WHERE id = ?`, [String(existing.id)]);
      }
      audit(req, {
        action: `${options.entity.toUpperCase()}_${options.softDelete ? 'ARCHIVED' : 'DELETED'}`,
        entity: options.entity,
        entityId: String(existing.id),
        stationId: (existing.station_id as string | undefined) ?? null,
        summary: options.softDelete ? `${options.entity} archived` : `${options.entity} deleted`,
      });
      return ok(res, { id: existing.id, deleted: true, softDeleted: Boolean(options.softDelete) });
    }),
  );

  return router;
}

export const isoDateTime = z
  .string()
  .min(10)
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO date-time');

export const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^-?\d+(\.\d+)?$/.test(value), 'Must be a decimal number');
