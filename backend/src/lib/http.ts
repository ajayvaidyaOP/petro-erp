import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { AppError, badRequest, unprocessable } from './errors.js';
import { isIsoDate } from './time.js';
import type { AuthContext } from './auth.js';

/** Wrap an async route handler so rejected promises reach the error middleware. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) result.catch(next);
    } catch (error) {
      next(error);
    }
  };
}

export function ok(res: Response, data: unknown, meta?: unknown) {
  return res.status(200).json(meta === undefined ? { data } : { data, meta });
}

export function created(res: Response, data: unknown) {
  return res.status(201).json({ data });
}

/** Validate a request payload and raise a 422 with field-level details. */
export function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw unprocessable('Validation failed', { issues });
}

export type Pagination = { page: number; pageSize: number; offset: number };

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export function paging(query: Record<string, unknown>): Pagination {
  const rawPage = Number.parseInt(String(query.page ?? '1'), 10);
  const rawSize = Number.parseInt(String(query.pageSize ?? DEFAULT_PAGE_SIZE), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize =
    Number.isFinite(rawSize) && rawSize > 0 ? Math.min(rawSize, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/**
 * Validate an optional YYYY-MM-DD query parameter.
 *
 * Date filters used to flow straight into `Date.UTC()`, where junk input such as
 * `?from=garbage` threw a RangeError and produced a 500 (and a row in
 * platform_errors). Rejecting it here turns that into a clean 422 instead.
 */
export function dayParam(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  if (!isIsoDate(value)) throw unprocessable(`${label} must be a valid YYYY-MM-DD date`);
  return value;
}

export function pageMeta(total: number, p: Pagination) {
  return {
    page: p.page,
    pageSize: p.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / p.pageSize)),
  };
}

/** Whitelisted ORDER BY builder — never interpolates client strings directly. */
export function sortClause(
  query: Record<string, unknown>,
  allowed: Record<string, string>,
  fallback: string,
): string {
  const sortBy = typeof query.sortBy === 'string' ? query.sortBy : '';
  const column = allowed[sortBy];
  if (!column) return fallback;
  const dir = String(query.sortDir ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  return `${column} ${dir}`;
}

export function parser<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw unprocessable('Validation failed', {
    issues: result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    })),
    first: issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : undefined,
  });
}

export function csvEscape(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvEscape).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(','));
  return [header, ...lines].join('\n');
}

export function clientIp(req: Request) {
  const forwarded = req.header('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0]!.trim() : req.socket.remoteAddress ?? null;
}

export function requestFingerprint(req: Request) {
  return createHash('sha256')
    .update(`${req.method} ${req.originalUrl}`)
    .digest('hex')
    .slice(0, 16);
}

export function assertFiniteNumber(value: string | number, field: string): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number`);
  return n;
}

export function requireHeader(req: Request, name: string) {
  const value = req.header(name);
  if (!value) throw badRequest(`Missing ${name} header`);
  return value;
}

export function isPlatform(auth: AuthContext) {
  return auth.user.roleKey === 'SUPER_ADMIN';
}

export { AppError };
