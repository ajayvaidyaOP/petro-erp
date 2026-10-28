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

/**
 * Additive column migrations for databases created by older schema versions.
 * schema.sql uses CREATE TABLE IF NOT EXISTS, so new *tables* appear on their
 * own — but new *columns* on existing tables need an explicit ALTER TABLE.
 * Each entry is only applied when the column is missing (idempotent).
 */
const COLUMN_MIGRATIONS: [table: string, column: string, ddl: string][] = [
  ['nozzles', 'tank_id', 'ALTER TABLE nozzles ADD COLUMN tank_id TEXT REFERENCES tanks(id) ON DELETE SET NULL'],
  ['tank_measurements', 'water_dip_cm', 'ALTER TABLE tank_measurements ADD COLUMN water_dip_cm TEXT'],
  ['shifts', 'cash_counted', 'ALTER TABLE shifts ADD COLUMN cash_counted TEXT'],
  ['shifts', 'short_excess', 'ALTER TABLE shifts ADD COLUMN short_excess TEXT'],
  ['shift_nozzle_readings', 'testing_litres', "ALTER TABLE shift_nozzle_readings ADD COLUMN testing_litres TEXT NOT NULL DEFAULT '0'"],
  ['shift_nozzle_readings', 'operator_id', 'ALTER TABLE shift_nozzle_readings ADD COLUMN operator_id TEXT REFERENCES users(id) ON DELETE SET NULL'],
  ['deliveries', 'dip_before_cm', 'ALTER TABLE deliveries ADD COLUMN dip_before_cm TEXT'],
  ['deliveries', 'dip_after_cm', 'ALTER TABLE deliveries ADD COLUMN dip_after_cm TEXT'],
  ['deliveries', 'density_invoice', 'ALTER TABLE deliveries ADD COLUMN density_invoice TEXT'],
  ['deliveries', 'density_observed', 'ALTER TABLE deliveries ADD COLUMN density_observed TEXT'],
  ['deliveries', 'temp_observed_c', 'ALTER TABLE deliveries ADD COLUMN temp_observed_c TEXT'],
  ['deliveries', 'density_at_15c', 'ALTER TABLE deliveries ADD COLUMN density_at_15c TEXT'],
  ['deliveries', 'tt_seal_numbers', 'ALTER TABLE deliveries ADD COLUMN tt_seal_numbers TEXT'],
  ['deliveries', 'sample_seal_no', 'ALTER TABLE deliveries ADD COLUMN sample_seal_no TEXT'],
  ['deliveries', 'chamber_details', 'ALTER TABLE deliveries ADD COLUMN chamber_details TEXT'],
  ['credit_entries', 'slip_number', 'ALTER TABLE credit_entries ADD COLUMN slip_number TEXT'],
  ['credit_entries', 'vehicle_number', 'ALTER TABLE credit_entries ADD COLUMN vehicle_number TEXT'],
  ['credit_entries', 'driver_name', 'ALTER TABLE credit_entries ADD COLUMN driver_name TEXT'],
  ['credit_entries', 'product_id', 'ALTER TABLE credit_entries ADD COLUMN product_id TEXT REFERENCES fuel_products(id) ON DELETE SET NULL'],
  ['credit_entries', 'quantity_litres', 'ALTER TABLE credit_entries ADD COLUMN quantity_litres TEXT'],
  ['credit_entries', 'rate_per_litre', 'ALTER TABLE credit_entries ADD COLUMN rate_per_litre TEXT'],
];

function applyColumnMigrations() {
  const db = getDb();
  for (const [table, column, ddl] of COLUMN_MIGRATIONS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.length === 0) continue; // table not created yet — schema.sql handles it
    if (!cols.some((c) => c.name === column)) db.exec(ddl);
  }
}

/** Execute a migration script (used at boot and by tests). */
export function migrate(schemaPath?: string) {
  const file = schemaPath ?? path.join(env.ROOT_DIR, 'db', 'schema.sql');
  const sql = fs.readFileSync(file, 'utf8');
  getDb().exec(sql);
  applyColumnMigrations();
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
