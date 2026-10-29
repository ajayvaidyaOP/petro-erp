import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/src -> backend -> repository root. Resolve paths from the module so
// database/schema locations stay stable regardless of the command's cwd.
export const ROOT_DIR = path.resolve(here, '../..');

const envFiles = [path.join(ROOT_DIR, '.env'), path.join(process.cwd(), '.env')];
for (const file of envFiles) {
  if (fs.existsSync(file)) {
    dotenv.config({ path: file });
    break;
  }
}

function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const nodeEnv = str('NODE_ENV', 'development');
const allowedOrigins = str('ALLOWED_ORIGINS', str('APP_ORIGIN', 'http://localhost:5173'))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const databaseFile = process.env.DATABASE_FILE ?? process.env.PETROFLOW_DB_FILE;

export const env = {
  NODE_ENV: nodeEnv,
  isProduction: nodeEnv === 'production',
  isProd: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
  ROOT_DIR,
  PORT: num('PORT', 4000),
  HOST: str('HOST', '0.0.0.0'),
  DATABASE_FILE: databaseFile
    ? path.isAbsolute(databaseFile)
      ? databaseFile
      : path.join(ROOT_DIR, databaseFile)
    : path.join(ROOT_DIR, 'backend', 'db', nodeEnv === 'test' ? 'test-petroflow.db' : 'petroflow.db'),
  SESSION_COOKIE_NAME: str('SESSION_COOKIE_NAME', 'pf_session'),
  SESSION_TTL_HOURS: num('SESSION_TTL_HOURS', 12),
  COOKIE_SECURE: bool('COOKIE_SECURE', nodeEnv === 'production'),
  TRUST_PROXY: bool('TRUST_PROXY', false),
  APP_ORIGIN: str('APP_ORIGIN', allowedOrigins[0] ?? 'http://localhost:5173'),
  ALLOWED_ORIGINS: allowedOrigins,
  ENABLE_DEMO_TOOLS: bool('ENABLE_DEMO_TOOLS', nodeEnv !== 'production'),
  DEMO_PASSWORD: str('DEMO_PASSWORD', 'PetroFlow@2025'),
  SEED_DEMO_DATA: bool('SEED_DEMO_DATA', true),
  LOG_LEVEL: str('LOG_LEVEL', nodeEnv === 'test' ? 'silent' : 'info'),
  RATE_LIMIT_WINDOW_MINUTES: num('RATE_LIMIT_WINDOW_MINUTES', 15),
  RATE_LIMIT_MAX: num('RATE_LIMIT_MAX', 2000),
  LOGIN_RATE_LIMIT_MAX: num('LOGIN_RATE_LIMIT_MAX', 20),
  GATEWAY_RATE_LIMIT_MAX: num('GATEWAY_RATE_LIMIT_MAX', 600),
  DEVICE_ONLINE_WINDOW_MINUTES: num('DEVICE_ONLINE_WINDOW_MINUTES', 5),
  BACKUP_RETENTION_DAYS: num('BACKUP_RETENTION_DAYS', 14),
  APP_VERSION: str('APP_VERSION', '1.0.0'),
  API_VERSION: 'v1',
} as const;

export type Env = typeof env;

/** Fail fast when a production deployment is missing security-critical configuration. */
export function assertProductionConfig() {
  if (!env.isProduction) return;
  const problems: string[] = [];
  if (!env.COOKIE_SECURE) problems.push('COOKIE_SECURE must be true in production');
  if (!process.env.SESSION_COOKIE_NAME) problems.push('SESSION_COOKIE_NAME should be set explicitly');
  if (env.ENABLE_DEMO_TOOLS) problems.push('ENABLE_DEMO_TOOLS must be false in production');
  if (/localhost|127\.0\.0\.1/.test(env.APP_ORIGIN)) {
    problems.push('APP_ORIGIN must be the public frontend origin in production');
  }
  if (problems.length > 0) {
    throw new Error(`Insecure production configuration:\n- ${problems.join('\n- ')}`);
  }
}
