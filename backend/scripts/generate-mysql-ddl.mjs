/**
 * Generates backend/db/mysql/schema.sql (MySQL 8 DDL) from backend/db/schema.sql.
 *
 * The application ships a SQLite adapter only — this file exists so a future MySQL migration has
 * a starting point that matches the SQLite schema exactly. Review it before running it:
 *   • inline `REFERENCES` in SQLite becomes a table-level FOREIGN KEY (MySQL ignores inline ones)
 *   • decimal quantities are TEXT in SQLite (Decimal.js does the maths) and stay VARCHAR here —
 *     convert the money/litre columns to DECIMAL(p,s) deliberately, per column
 *   • MySQL has no `CREATE INDEX IF NOT EXISTS`; this script emits `ALTER TABLE … ADD INDEX`
 *     guarded by an information_schema check where possible
 *
 * Usage: npm run db:mysql-ddl
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(backendRoot, 'db', 'schema.sql');
const target = path.join(backendRoot, 'db', 'mysql', 'schema.sql');

const RESERVED = new Set(['key', 'value', 'type', 'status', 'references', 'order', 'group', 'condition', 'interval', 'usage', 'rows', 'read', 'check']);

const backtick = (name) => `\`${name}\``;
const quoteIdents = (sql) =>
  sql.replace(/\b([a-z_][a-z0-9_]*)\b/g, (word, ...rest) => {
    const before = rest[rest.length - 1];
    // Do not touch the token after a dot (function call) or already-quoted names.
    if (before.endsWith('.')) return word;
    return RESERVED.has(word) ? backtick(word) : word;
  });

/** Split on top-level commas (paren depth 0) — enough for CREATE TABLE column lists. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// Columns that genuinely hold prose/JSON: keep TEXT unless they need an index or a default.
const LONG_TEXT = /(notes?|description|details?|address|summary|reason|remarks?|body|payload|data|features|message|text)$/i;

/**
 * SQLite has one flexible text type; MySQL needs a length for anything indexed and forbids
 * defaults on bare TEXT. Rule: id/FK/enum-ish columns → VARCHAR, prose → TEXT, and every
 * decimal quantity stays VARCHAR because the app (Decimal.js) — not the database — owns the maths.
 */
function convertColumn(rawLine) {
  // Work on a backtick-free, comment-free copy; identifiers are re-quoted on output.
  const out = rawLine.replace(/^\s*--.*$/gm, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  const nameMatch = /^(\w+)\s+/.exec(out);
  if (!nameMatch) return out;
  const name = nameMatch[1];
  const col = backtick(name);

  if (new RegExp(`^${name}\\s+TEXT\\s+PRIMARY KEY`, 'i').test(out)) {
    return `${col} VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY`;
  }
  const textMatch = new RegExp(`^${name}\\s+TEXT\\b(.*)$`, 'i').exec(out);
  if (textMatch) {
    const mods = (textMatch[1] ?? '').trim();
    // Surrogate keys are VARCHAR(64) ascii so that FOREIGN KEY columns match the
    // referenced `id` column exactly — MySQL refuses a length mismatch.
    if (/^(id|\w+_id)$/.test(name)) {
      return `${col} VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin${mods ? ` ${mods}` : ''}`;
    }
    // The API stores UTC ISO-8601 strings and compares them as text. DATETIME
    // rejects the "T"/"Z" form and would change sort order, so these stay strings.
    if (/(_at|_timestamp)$/.test(name)) return `${col} VARCHAR(40)${mods ? ` ${mods}` : ''}`;
    if (/(_date|_on|_month|business_date)$/.test(name) || name === 'month') {
      return `${col} DATE${mods ? ` ${mods}` : ''}`;
    }
    // Role and staff grants are JSON arrays. VARCHAR(255) truncates the owner list.
    if (/permissions$/.test(name) || name === 'password_hash' || name === 'user_agent') {
      return `${col} VARCHAR(2048)${mods ? ` ${mods}` : ''}`;
    }
    const prose = LONG_TEXT.test(name);
    // MySQL: no index or default on bare TEXT → those cases need a VARCHAR width.
    const needsWidth = /DEFAULT|UNIQUE|PRIMARY/i.test(mods) || !prose;
    if (!needsWidth) return `${col} TEXT${mods ? ` ${mods}` : ''}`;
    return `${col} VARCHAR(${prose ? 1024 : 255})${mods ? ` ${mods}` : ''}`;
  }
  if (new RegExp(`^${name}\\s+INTEGER\\s+(NOT NULL\\s+)?DEFAULT\\s+[01]\\b`, 'i').test(out)) {
    return out.replace(/\bINTEGER\b/i, 'TINYINT(1)').replace(new RegExp(`^${name}\\b`), col);
  }
  return out.replace(new RegExp(`^${name}\\s+INTEGER\\b`, 'i'), `${col} INT`);
}

function convertCreateTable(statement) {
  const header = /CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*)\)$/m.exec(statement.trim().replace(/;$/, ''));
  if (!header) return `${statement.trim()};`;
  const [, table, body] = header;
  const parts = splitTopLevel(body);
  const foreignKeys = [];
  const columns = [];

  for (const part of parts) {
    if (/^PRIMARY KEY\s*\(/i.test(part)) { columns.push(part); continue; }
    if (/^UNIQUE\s*\(/i.test(part)) {
      const cols = part.slice(part.indexOf('(') + 1, part.lastIndexOf(')')).trim();
      columns.push(`UNIQUE KEY ${backtick(`uq_${table}_${cols.replace(/[^a-z0-9_]/gi, '_')}`)} (${cols})`);
      continue;
    }
    if (/^(FOREIGN KEY|CHECK)\b/i.test(part)) { columns.push(part); continue; }

    // Hoist inline REFERENCES into a table-level FK, keeping the column definition clean.
    const ref = /(\w+)\s+[^,]*?REFERENCES\s+(\w+)\s*\((\w+)\)([^,]*)/i.exec(part);
    if (ref) {
      const [, col, refTable, refCol, action] = ref;
      const cleaned = part.replace(/\s*REFERENCES\s+\w+\s*\(\w+\)[^,]*/i, '').trim();
      columns.push(convertColumn(cleaned));
      foreignKeys.push(
        `  CONSTRAINT ${backtick(`fk_${table}_${col}`)} FOREIGN KEY (${backtick(col)}) REFERENCES ${backtick(refTable)} (${backtick(refCol)})${action
          .replace(/\s+/g, ' ')
          .trim() ? ` ${action.trim()}` : ''}`,
      );
      continue;
    }
    columns.push(convertColumn(quoteIdents(part)));
  }

  const rows = [...columns, ...foreignKeys].map((line) => `  ${line}`);
  return [
    `CREATE TABLE IF NOT EXISTS ${backtick(table)} (`,
    rows.join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
  ].join('\n');
}

function convertIndex(statement) {
  const m = /CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+) ON (\w+)\s*\(([^)]*)\)/i.exec(statement.trim().replace(/;$/, ''));
  if (!m) return `${statement.trim()};`;
  const [, unique, name, table, cols] = m;
  return [
    `SET @exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = '${table}' AND index_name = '${name}');`,
    `SET @ddl := IF(@exists = 0, 'ALTER TABLE ${backtick(table)} ADD ${unique ? 'UNIQUE ' : ''}INDEX ${backtick(name)} (${cols.trim()})', 'DO 0');`,
    'PREPARE stmt FROM @ddl;',
    'EXECUTE stmt;',
    'DEALLOCATE PREPARE stmt;',
  ].join('\n');
}

function convert(sql) {
  // Drop the SQLite source's line comments (this file gets its own header) so every
  // statement starts on its own terms, then split on top-level semicolons.
  const statements = sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .filter((line) => line.trim())
    .join('\n')
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [
    '-- ============================================================================',
    '-- GENERATED FILE — do not edit by hand.',
    '-- Produced by scripts/generate-mysql-ddl.mjs from db/schema.sql (the source of truth).',
    '-- The application currently ships a SQLite adapter (node:sqlite); this DDL exists for a',
    '-- future MySQL deployment and must be reviewed — see the header of the generator.',
    '-- ============================================================================',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    '',
  ];

  for (const statement of statements) {
    if (/^PRAGMA\b/i.test(statement)) continue;
    if (/^--/.test(statement) && !/\S/.test(statement.replace(/^--.*$/gm, ''))) continue;
    if (/^CREATE TABLE/i.test(statement)) {
      out.push(convertCreateTable(statement), '');
      continue;
    }
    if (/^CREATE (UNIQUE )?INDEX/i.test(statement)) {
      out.push(convertIndex(statement), '');
      continue;
    }
    out.push(statement.endsWith(';') ? statement : `${statement};`, '');
  }

  out.push('SET FOREIGN_KEY_CHECKS = 1;');
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}

const result = convert(fs.readFileSync(source, 'utf8'));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, result, 'utf8');
const tables = (result.match(/CREATE TABLE/g) ?? []).length;
const indexes = (result.match(/ADD (?:UNIQUE )?INDEX/g) ?? []).length;
const fks = (result.match(/FOREIGN KEY/g) ?? []).length;
console.log(`✔ wrote ${path.relative(backendRoot, target)} — ${tables} tables, ${indexes} indexes, ${fks} foreign keys`);
console.log('  review before use: decimal TEXT/VARCHAR columns and any engine choice are not decided here.');
