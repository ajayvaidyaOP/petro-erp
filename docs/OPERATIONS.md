# Operations

Runbook for a person who has to keep one PetroFlow instance alive at a pump (or for a small
hosting setup with 2–5 pumps). Deployment is intentionally manual: this repo does not ship
container or IaC definitions.

## Requirements

| | |
|---|---|
| Runtime | Node.js **22.13.0+** (backend uses built-in `node:sqlite`) |
| Process | **one** API instance per database file — SQLite is single-writer |
| Disk | `DATABASE_FILE` on durable, backed-up storage. Never ephemeral container storage |
| TLS | Reverse proxy (Caddy/nginx) terminating HTTPS in front of `PORT=4000` |
| Network | The forecourt gateway reaches the API over LAN or HTTPS; the API never needs a public port if the gateway is local |

## First run

```powershell
npm ci
npm run build
Copy-Item .env.example .env    # then edit
npm start                      # serves SPA + /api/v1 on one origin
```

`.env` for a real deployment must set at least:

```ini
NODE_ENV=production
COOKIE_SECURE=true
SESSION_COOKIE_NAME=pf_session_prod
APP_ORIGIN=https://erp.example.com
ALLOWED_ORIGINS=https://erp.example.com
ENABLE_DEMO_TOOLS=false
DATABASE_FILE=/var/lib/petroflow/petroflow.db
```

Production startup **fails fast** when these security settings are missing — that is a feature.
Do not reuse demo accounts or `DEMO_PASSWORD`; do not seed demo data against a real tenant.

## Health and diagnostics

| Check | Command / URL |
|---|---|
| API alive | `curl -s localhost:4000/api/v1/health` → `{"status":"ok", …}` |
| Database + newest snapshot | `npm run db:integrity` |
| Schema/permission drift, gateway state | Settings → Diagnostics (`GET /api/v1/settings/diagnostics`) |
| Platform errors | `platform_errors` table, admin → Errors |
| Gateway connectivity | device `last_heartbeat_at` (offline window: `hardware.heartbeatTimeoutMinutes`) |

## Backups

The database is the entire business record: shifts, totalizers, stock ledger, credit, audit log.
Losing it is not recoverable from anywhere else.

```powershell
npm run db:backup      # snapshot + sha256 sidecar + retention prune
npm run db:integrity   # verify live db AND the newest snapshot
npm run db:restore -- --from db/backups/petroflow-20261029-070000.123.db --yes
```

- Snapshots land in `db/backups/petroflow-<UTC>.db` (+ `.sha256`). Use `--out` for a second
  destination (external disk / mounted share).
- Backups are taken with `VACUUM INTO`, so they include committed WAL content and are compacted —
  a plain file copy of `petroflow.db` while the API is writing is **not** a safe backup.
- `BACKUP_RETENTION_DAYS` (default 14) prunes old snapshots; the newest snapshot is never pruned.
- Restore verifies the sidecar hash and `PRAGMA integrity_check` **before** touching the live
  file, copies the current file to `pre-restore-<stamp>.db` first, and removes stale `-wal`/`-shm`
  sidecars so they cannot be replayed into the restored database.
- `db/backups/` is git-ignored. Copies must live **off** the pump's disk; a snapshot next to the
  database protects against corruption, not against disk or theft loss.

### Suggested cadence for a pump

1. Nightly snapshot after day close (07:00 IST is a good habit for the Indian timezone).
2. Copy to a second location (cloud sync or USB taken home) at least daily.
3. `npm run db:integrity` weekly — a green check means both the live file and the newest backup are readable.
4. **Test a restore quarterly** on a spare machine. An untested backup is a rumour.

## Migration / upgrade

```powershell
git pull
npm ci
npm run db:backup          # ALWAYS before booting the new version
npm run build
npm start                  # boot applies additive column migrations + role sync
npm run db:integrity
```

Migrations are additive; business records are never deleted. If a release notes a destructive
change, restore is: `npm run db:restore -- --from <pre-upgrade snapshot> --yes`.

## Log files

`pino` JSON to stdout (`LOG_LEVEL=info|debug|warn|error`). Put it in a file or a journal, not a
terminal window: `pm2 start … --log /var/log/petroflow/api.log` or systemd-journald.
`platform_errors` captures API-side failures for the admin UI; the gateway keeps its own spool
(`PETROFLOW_STATION_ID`/`PETROFLOW_SPOOL_FILE`) so readings survive an outage.

## Housekeeping worth scheduling

| Job | Command |
|---|---|
| Integrity check | `npm run db:integrity` |
| Vacuum/compact (offline window) | stop API → `npm run db:backup` → the snapshot is already compacted; restore it if the live file has grown oddly |
| Session hygiene | revoke stale rows in `sessions` (`revoked_at`), or have users sign out from Settings |
| Dependency advisories | `npm audit` before every deploy |

## Rollback / disaster

| Symptom | Do |
|---|---|
| Bad release | `git checkout <last-good-tag>` → `npm ci && npm run build` → restore the snapshot taken before the upgrade if the new schema wrote data |
| Corrupt database (integrity check fails) | Stop the API. Restore the newest verified snapshot; expect to lose only entries made after it, then re-enter those from the paper DSR |
| Deleted/overwritten row | Find it in `audit_logs` (`before_data`) and re-post by hand; audit is the recovery source |
| Disk failure | Rebuild the host, restore the last off-site snapshot, re-register the gateway key (Settings → Devices → rotate key) |
| Locked out of both accounts | Restore a snapshot from when you knew the credentials, or update `users.password_hash` with a fresh `hashPassword()` value from a Node REPL against a **copy** of the file — never the live one |

## What is not yet operational

No container image, no HA (single writer), no auto-update, no metrics endpoint, no notification
delivery (email/SMS/WhatsApp), no off-site replication, and **no real dispenser certification**
(`gateway/src/adapters/modbusTcp.ts` throws until a vendor register map is tested on-site). Plan
for a human to be able to run the pump on paper for a day while the system is restored.
