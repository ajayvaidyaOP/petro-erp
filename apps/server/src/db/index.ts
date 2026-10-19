import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { env } from '../env.js';

// Resolve Node's built-in SQLite driver via require() so bundlers/test runners
// do not try to resolve the experimental `node:sqlite` specifier themselves.
type DatabaseSync = import('node:sqlite').DatabaseSync;
const require = createRequire(import.meta.url);
let DatabaseSyncCtor: new (file: string) => DatabaseSync;
try {
  ({ DatabaseSync: DatabaseSyncCtor } = require('node:sqlite') as typeof import('node:sqlite'));
} catch {
  throw new Error(
    'This Node.js runtime has no node:sqlite support. Use Node 22+ or switch the ' +
      'database adapter to MySQL (see docs/ARCHITECTURE.md).',
  );
}

export type SqlValue = string | number | bigint | null;
export type Row = Record<string, unknown>;

let database: DatabaseSync | null = null;

function open() {
  fs.mkdirSync(path.dirname(env.DATABASE_FILE), { recursive: true });
  const db = new DatabaseSyncCtor(env.DATABASE_FILE);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function getDb(): DatabaseSync {
  if (!database) database = open();
  return database;
}

/** Execute a migration script (used at boot and by tests). */
export function migrate(schemaPath?: string) {
  const file = schemaPath ?? path.join(env.ROOT_DIR, 'db', 'schema.sql');
  const sql = fs.readFileSync(file, 'utf8');
  getDb().exec(sql);
}

function bind(params: unknown[]): SqlValue[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p as SqlValue;
  });
}

export function all<T = Row>(sql: string, params: unknown[] = []): T[] {
  const stmt = getDb().prepare(sql);
  return stmt.all(...bind(params)) as T[];
}

export function get<T = Row>(sql: string, params: unknown[] = []): T | undefined {
  const stmt = getDb().prepare(sql);
  return stmt.get(...bind(params)) as T | undefined;
}

export function run(sql: string, params: unknown[] = []) {
  const stmt = getDb().prepare(sql);
  return stmt.run(...bind(params));
}

export function scalar<T = number>(sql: string, params: unknown[] = []): T | undefined {
  const row = get<Record<string, T>>(sql, params);
  if (!row) return undefined;
  const values = Object.values(row);
  return values[0];
}

let txDepth = 0;

/** Run a function inside a SQLite transaction (nested calls become savepoints). */
export function tx<T>(fn: () => T): T {
  const db = getDb();
  if (txDepth > 0) {
    const savepoint = `sp_${txDepth}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    txDepth += 1;
    try {
      const result = fn();
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      txDepth -= 1;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth = 1;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw error;
  } finally {
    txDepth = 0;
  }
}

/**
 * Convert a snake_case row into a camelCase API object and parse JSON columns.
 * Dates remain ISO strings (UTC) — the UI formats them for Asia/Kolkata.
 */
export function shape<T = Record<string, unknown>>(
  row: Row | undefined,
  jsonColumns: string[] = [],
): T | null {
  if (!row) return null;
  const jsonKeys = new Set(jsonColumns.map(toCamel));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = toCamel(key);
    let v = value;
    if (jsonKeys.has(camel) && typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch {
        v = null;
      }
    }
    if (v && typeof v === 'bigint') v = Number(v);
    out[camel] = v;
  }
  return out as T;
}

export function shapeAll<T = Record<string, unknown>>(
  rows: Row[],
  jsonColumns: string[] = [],
): T[] {
  return rows.map((row) => shape<T>(row, jsonColumns)!) as T[];
}

export function toCamel(value: string) {
  return value.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toSnake(value: string) {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
