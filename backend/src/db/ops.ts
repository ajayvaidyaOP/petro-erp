/**
 * Database operations CLI — snapshot backup, verified restore, integrity check.
 *
 * SQLite is the shipped adapter, so "backup" means a consistent snapshot via
 * `VACUUM INTO` (includes WAL content, compacted, single file) — not a file copy
 * of a live database. Every backup is integrity-checked and gets a sha256 sidecar
 * so a restore can prove which file it came from.
 *
 *   npm run db:backup            # snapshot into backend/db/backups/ + prune by retention
 *   npm run db:integrity         # live DB + newest backup (hash + integrity_check)
 *   npm run db:restore -- --from db/backups/petroflow-....db --yes
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { env } from '../env.js';

type DatabaseSync = import('node:sqlite').DatabaseSync;
// Resolved through require() so bundlers/test runners do not resolve the
// experimental `node:sqlite` specifier themselves (same trick as db/index.ts).
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (file: string, opts?: Record<string, unknown>) => DatabaseSync };

export interface IntegrityReport {
  ok: boolean;
  message: string;
}

export interface BackupResult {
  file: string;
  checksum: string;
  bytes: number;
  takenAt: string;
  source: string;
}

const BACKUP_DIR = 'backend/db/backups';

export function resolveDataFile(file?: string): string {
  const target = file ?? env.DATABASE_FILE;
  return path.isAbsolute(target) ? target : path.resolve(env.ROOT_DIR, target);
}

export function resolveBackupDir(dir?: string): string {
  const target = dir ?? BACKUP_DIR;
  return path.isAbsolute(target) ? target : path.resolve(env.ROOT_DIR, target);
}

/** Single-quote a literal for SQLite (VACUUM INTO takes an expression). */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function withDb<T>(file: string, fn: (db: DatabaseSync) => T, readOnly = false): T {
  const db = new DatabaseSync(file, readOnly ? { readOnly: true, open: true } : { open: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** `PRAGMA integrity_check` plus a fast sanity read of the schema. */
export function checkIntegrity(file: string): IntegrityReport {
  if (!fs.existsSync(file)) return { ok: false, message: `file not found: ${file}` };
  try {
    return withDb(file, (db) => {
      const rows = db.prepare('PRAGMA integrity_check').all() as { integrity_check?: string }[];
      const verdict = rows[0]?.integrity_check ?? 'no result';
      if (verdict !== 'ok') return { ok: false, message: verdict };
      const tables = db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'").get() as { c: number };
      return { ok: true, message: `ok (${Number(tables.c)} tables)` };
    }, true);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

export function checksumFile(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function stamp(now = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, '').replace('T', '-')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

/** Two snapshots in the same millisecond still need distinct files. */
function uniqueTarget(dir: string, base: string): string {
  let candidate = path.join(dir, `${base}.db`);
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${suffix}.db`);
    suffix += 1;
  }
  return candidate;
}

export function listBackups(dir?: string): { file: string; mtimeMs: number }[] {
  const base = resolveBackupDir(dir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .filter((name) => /^petroflow-.*\.db$/.test(name))
    .map((name) => {
      const file = path.join(base, name);
      return { file, mtimeMs: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Remove snapshots past the retention window. The newest snapshot is never pruned. */
export function pruneBackups(dir: string, keepDays: number): string[] {
  const backups = listBackups(dir);
  if (backups.length < 2 || keepDays <= 0) return [];
  const cutoff = Date.now() - keepDays * 86_400_000;
  const removed: string[] = [];
  // slice(1) protects the newest snapshot, so pruning can never leave zero backups.
  backups.slice(1).forEach((entry) => {
    if (entry.mtimeMs >= cutoff) return;
    for (const suffix of ['', '.sha256']) {
      if (fs.existsSync(`${entry.file}${suffix}`)) fs.rmSync(`${entry.file}${suffix}`);
    }
    removed.push(path.basename(entry.file));
  });
  return removed;
}

export function createBackup(options: { dir?: string; keepDays?: number; dbFile?: string; label?: string } = {}): BackupResult {
  const source = resolveDataFile(options.dbFile);
  if (!fs.existsSync(source)) throw new Error(`Database file not found: ${source}. Run \`npm run db:seed\` first.`);
  const dir = resolveBackupDir(options.dir);
  fs.mkdirSync(dir, { recursive: true });
  const label = options.label ? `-${options.label.replace(/[^a-z0-9._-]/gi, '-')}` : '';
  const file = uniqueTarget(dir, `petroflow-${stamp()}${label}`);

  // VACUUM INTO reads a snapshot; it needs no exclusive lock and skips free pages.
  withDb(source, (db) => db.exec(`VACUUM INTO ${sqlString(file)}`));

  const check = checkIntegrity(file);
  if (!check.ok) {
    fs.rmSync(file, { force: true });
    throw new Error(`Backup failed integrity_check: ${check.message}`);
  }
  const checksum = checksumFile(file);
  const bytes = fs.statSync(file).size;
  fs.writeFileSync(`${file}.sha256`, `${checksum}  ${path.basename(file)}\n`, 'utf8');

  const keepDays = options.keepDays ?? env.BACKUP_RETENTION_DAYS;
  const pruned = pruneBackups(dir, keepDays);

  return { file, checksum, bytes, takenAt: new Date().toISOString(), source: `${source}${pruned.length ? ` (pruned ${pruned.length})` : ''}` };
}

/** Verify a snapshot's sidecar hash and internal integrity before using it. */
export function verifyBackup(file: string): IntegrityReport {
  const sidecar = `${file}.sha256`;
  if (!fs.existsSync(file)) return { ok: false, message: `backup not found: ${file}` };
  if (fs.existsSync(sidecar)) {
    const expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0] ?? '';
    const actual = checksumFile(file);
    if (expected && expected !== actual) return { ok: false, message: `checksum mismatch (expected ${expected.slice(0, 12)}…, got ${actual.slice(0, 12)}…)` };
  }
  return checkIntegrity(file);
}

/**
 * Replace the live database with a verified snapshot. The previous live file is
 * copied into the backup dir first, so a wrong `--from` is always reversible.
 */
export function restoreBackup(options: { from: string; yes?: boolean; dbFile?: string; dir?: string }): { restored: string; safetyCopy: string | null } {
  const source = path.isAbsolute(options.from) ? options.from : resolveDataFile(options.from);
  const report = verifyBackup(source);
  if (!report.ok) throw new Error(`Refusing to restore an unverified snapshot: ${report.message}`);
  const target = resolveDataFile(options.dbFile);
  const targetExists = fs.existsSync(target) && fs.statSync(target).size > 0;
  if (targetExists && !options.yes) {
    throw new Error(`Refusing to overwrite ${target}. Re-run with --yes after you have confirmed the snapshot.`);
  }

  let safetyCopy: string | null = null;
  if (targetExists) {
    const dir = resolveBackupDir(options.dir);
    fs.mkdirSync(dir, { recursive: true });
    safetyCopy = uniqueTarget(dir, `pre-restore-${stamp()}`);
    fs.copyFileSync(target, safetyCopy);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${target}${suffix}`)) fs.copyFileSync(`${target}${suffix}`, `${safetyCopy}${suffix}`);
    }
  }

  // A stale WAL next to a freshly copied database would be replayed into it.
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${target}${suffix}`, { force: true });
  fs.copyFileSync(source, target);
  const after = checkIntegrity(target);
  if (!after.ok) throw new Error(`Restore completed but the target failed integrity_check: ${after.message}`);
  return { restored: target, safetyCopy };
}

function parseArgs(argv: string[]): { command: string; flags: Record<string, string | boolean> } {
  const [command = 'integrity', ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else flags[key] = true;
  }
  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function run() {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (command === 'backup') {
    const result = createBackup({
      dir: flagString(flags, 'out'),
      keepDays: flags.keep !== undefined ? Number(flags.keep) : undefined,
      dbFile: flagString(flags, 'db'),
      label: flagString(flags, 'label'),
    });
    console.log(`✔ snapshot   ${path.relative(env.ROOT_DIR, result.file)} (${(result.bytes / 1024).toFixed(1)} KiB)`);
    console.log(`  sha256     ${result.checksum}`);
    console.log(`  source     ${path.relative(env.ROOT_DIR, resolveDataFile(flags.db as string | undefined))}`);
    console.log(`  taken at   ${result.takenAt}`);
    if (result.source.includes('pruned')) console.log(`  retention  ${result.source.split('(')[1]!.replace(')', '')}`);
    return;
  }

  if (command === 'integrity') {
    const live = resolveDataFile(flagString(flags, 'db'));
    const liveReport = checkIntegrity(live);
    console.log(`${liveReport.ok ? '✔' : '✖'} live db    ${path.relative(env.ROOT_DIR, live)} — ${liveReport.message}`);
    const latest = listBackups(flagString(flags, 'out'))[0];
    if (!latest) {
      console.log('! no backups  run `npm run db:backup` to create the first snapshot');
    } else {
      const backupReport = verifyBackup(latest.file);
      console.log(`${backupReport.ok ? '✔' : '✖'} backup     ${path.relative(env.ROOT_DIR, latest.file)} — ${backupReport.message}`);
    }
    if (!liveReport.ok || (latest && !verifyBackup(latest.file).ok)) process.exitCode = 1;
    return;
  }

  if (command === 'restore') {
    const from = flagString(flags, 'from');
    if (!from) throw new Error('Usage: npm run db:restore -- --from <snapshot.db> --yes');
    const result = restoreBackup({ from, yes: flags.yes === true, dbFile: flagString(flags, 'db') });
    console.log(`✔ restored   ${path.relative(env.ROOT_DIR, result.restored)}`);
    if (result.safetyCopy) console.log(`  safety     ${path.relative(env.ROOT_DIR, result.safetyCopy)}`);
    console.log('  next       start the API and open /api/v1/health, then sign in and check today\'s shift list');
    return;
  }

  throw new Error(`Unknown command "${command}". Use: backup | restore | integrity`);
}

// Only the CLI path executes — importing these helpers from tests must not exit.
if (process.argv[1] && path.resolve(process.argv[1]).includes(`${path.sep}ops.ts`)) {
  try {
    run();
  } catch (error) {
    console.error(`✖ ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
