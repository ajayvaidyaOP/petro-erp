/**
 * Backup / restore / integrity tooling (backend/src/db/ops.ts).
 * Runs against a throwaway SQLite file so the demo and test databases are untouched.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { checkIntegrity, createBackup, listBackups, pruneBackups, restoreBackup, verifyBackup } from '../src/db/ops.js';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

let tmpDir: string;
let dbFile: string;
let outDir: string;

function seedDatabase(file: string, marker: string) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE widgets (id INTEGER PRIMARY KEY, marker TEXT);');
  db.exec(`INSERT INTO widgets (marker) VALUES ('${marker}');`);
  db.close();
}

function readMarker(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const row = db.prepare('SELECT marker FROM widgets ORDER BY id DESC LIMIT 1').get() as { marker: string };
    return row.marker;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petroflow-backup-'));
  dbFile = path.join(tmpDir, 'app.db');
  outDir = path.join(tmpDir, 'backups');
  seedDatabase(dbFile, 'before-backup');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('db:backup', () => {
  it('writes a verified snapshot with a matching sha256 sidecar', () => {
    const result = createBackup({ dbFile, dir: outDir, keepDays: 14 });
    expect(fs.existsSync(result.file)).toBe(true);
    expect(fs.existsSync(`${result.file}.sha256`)).toBe(true);
    expect(checkIntegrity(result.file).ok).toBe(true);
    const sidecar = fs.readFileSync(`${result.file}.sha256`, 'utf8').trim().split(/\s+/)[0];
    expect(sidecar).toBe(crypto.createHash('sha256').update(fs.readFileSync(result.file)).digest('hex'));
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('captures committed rows that still sit in the WAL', () => {
    const db = new DatabaseSync(dbFile);
    db.exec('PRAGMA journal_mode = WAL;');
    db.prepare("INSERT INTO widgets (marker) VALUES ('wal-only')").run();
    db.close();

    const result = createBackup({ dbFile, dir: outDir });
    expect(readMarker(result.file)).toBe('wal-only');
  });

  it('keeps at most the retention window but never the newest snapshot', () => {
    createBackup({ dbFile, dir: outDir, keepDays: 0 });
    const second = createBackup({ dbFile, dir: outDir, keepDays: 0 });
    const stale = listBackups(outDir).find((entry) => entry.file !== second.file);
    expect(stale).toBeDefined();
    if (stale) fs.utimesSync(stale.file, new Date(0), new Date(0));
    const removed = pruneBackups(outDir, 7);
    expect(removed.length).toBe(1);
    expect(fs.existsSync(second.file)).toBe(true);
    expect(listBackups(outDir)).toHaveLength(1);
  });
});

describe('db:restore', () => {
  it('refuses an unverified snapshot and an unconfirmed overwrite', () => {
    const snapshot = createBackup({ dbFile, dir: outDir });
    fs.writeFileSync(snapshot.file, 'corrupted');
    expect(() => restoreBackup({ from: snapshot.file, dbFile })).toThrow(/unverified/i);

    const good = createBackup({ dbFile, dir: outDir, label: 'good' });
    expect(() => restoreBackup({ from: good.file, dbFile })).toThrow(/--yes/);
  });

  it('rolls data back and keeps a safety copy of the pre-restore file', () => {
    const snapshot = createBackup({ dbFile, dir: outDir });
    seedDatabaseAfterBackup();
    expect(readMarker(dbFile)).toBe('after-backup');

    const result = restoreBackup({ from: snapshot.file, yes: true, dbFile, dir: outDir });
    expect(result.restored).toBe(dbFile);
    expect(readMarker(dbFile)).toBe('before-backup');
    expect(result.safetyCopy).toBeTruthy();
    expect(fs.existsSync(result.safetyCopy!)).toBe(true);
    expect(readMarker(result.safetyCopy!)).toBe('after-backup');
    expect(checkIntegrity(dbFile).ok).toBe(true);
  });

  it('drops the stale WAL so it cannot be replayed into the restored file', () => {
    const snapshot = createBackup({ dbFile, dir: outDir });
    fs.writeFileSync(`${dbFile}-wal`, 'stale wal');
    restoreBackup({ from: snapshot.file, yes: true, dbFile, dir: outDir });
    expect(fs.existsSync(`${dbFile}-wal`)).toBe(false);
    expect(fs.existsSync(`${dbFile}-shm`)).toBe(false);
    expect(verifyBackup(snapshot.file).ok).toBe(true);
  });
});

/** Rewrite the live file in place, mimicking a day of writes after a snapshot. */
function seedDatabaseAfterBackup() {
  const db = new DatabaseSync(dbFile);
  db.exec('DELETE FROM widgets;');
  db.exec("INSERT INTO widgets (marker) VALUES ('after-backup');");
  db.close();
}
