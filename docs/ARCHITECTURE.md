# Architecture

How PetroFlow is put together, and why. Written for a developer opening the repo for
the first time; `README.md` covers commands, `OPERATIONS.md` covers running it.

## Shape

```text
┌────────────┐  relative /api/v1/*   ┌──────────────┐   node:sqlite   ┌──────────────┐
│  frontend/ │ ────────────────────▶ │  backend/    │ ──────────────▶ │  db/         │
│ React+Vite │                       │ Express API  │                 │ schema.sql   │
└────────────┘                       │  (port 4000) │                 │ petroflow.db │
                                     └──────┬───────┘                 └──────────────┘
                                            │  X-Device-Key, NDJSON events
                                     ┌──────┴───────┐        ┌───────────────────────┐
                                     │  gateway/    │◀──────▶│ forecourt controller  │
                                     │ local agent  │        │ / ATG / simulator     │
                                     └──────────────┘        └───────────────────────┘
                    packages/shared/  ← constants, permissions, roles (imported by both sides)
```

Four npm workspaces (`packages/shared`, `backend`, `frontend`, `gateway`) plus `db/` for
schema and the local database file. One deployable unit: Express serves the built SPA and
the API from the same origin (`npm run build && npm start`).

## Data model — four layers

| Layer | Tables | Rule |
|---|---|---|
| **Tenancy** | `tenants`, `stations`, `users`, `roles`, `user_station_access`, `sessions`, `subscriptions*` | A tenant is a dealer organisation; a station is one pump. Every business row carries `tenant_id` and usually `station_id`. |
| **Master data** | `fuel_products`, `fuel_prices`, `tanks`, `tank_calibration_points`, `dispensers`, `nozzles`, `customers`, `customer_vehicles`, `suppliers`, `expense_categories`, `lube_products` | Prices and rates are versioned (`effective_from/to`), never overwritten. |
| **Operations** | `shifts`, `shift_nozzle_readings`, `shift_cash_denominations`, `shift_settlements`, `meter_readings`, `fuel_transactions`, `deliveries`, `stock_movements`, `tank_measurements`, `density_checks`, `day_closings` | Stock and sales are **derived**, never hand-set. |
| **Money & governance** | `credit_entries`, `payments`, `expenses`, `reconciliations`, `compliance_documents`, `lube_movements`, `attendance_records`, `audit_logs`, `idempotency_keys`, `app_settings`, `platform_errors` | Every mutation writes an audit row with before/after. |

`db/schema.sql` is the single source of truth (46 tables). It uses `CREATE TABLE IF NOT
EXISTS`, so a *new table* appears at boot with no migration step. A *new column* on an
existing table must also be registered in `COLUMN_MIGRATIONS`
(`backend/src/db/index.ts`), which is where additive `ALTER TABLE`s live; each entry is
applied only when the column is missing, so boot is idempotent.

## The rules that hold the domain together

1. **Exact decimal, always.** Money, litres and rates are stored as decimal `TEXT` and
   computed with Decimal.js (`backend/src/lib/decimal.ts`). No IEEE-754 float arithmetic
   anywhere in a business path — a totalizer difference must reproduce to the litre.
2. **Sales come from meters, not from invoices.** A shift's litres = closing − opening
   totalizer per nozzle, then net of *testing litres* (calibration/sample fuel that goes
   back to the tank). `lib/meter.ts` classifies every reading
   (`VALID | SUSPICIOUS | NEGATIVE | STALE | RESET | GAP`); a suspicious reading is excluded
   from counted litres and forces the shift to `FLAGGED` for a human. A meter rollover is
   never silently converted.
3. **Tank stock is a ledger.** `stock_movements` (`OPENING | DELIVERY | DISPENSED |
   ADJUSTMENT | TRANSFER_IN | TRANSFER_OUT`) is the only writer of stock
   (`lib/stock.ts`). Book stock is the sum. A dip reading is a *measurement* that produces a
   variance row, never an edit of the balance. Dispensed litres are allocated to the tank
   the nozzle is hard-mapped to (`nozzles.tank_id`); pro-rata allocation is only a fallback
   for an unmapped nozzle.
4. **Dip → litres needs a calibration chart.** `convertDipToLitres` refuses to guess when a
   tank has no `tank_calibration_points`.
5. **A shift that is not closed has no sales.** Posting happens at close; reversing a shift
   writes inverse movements rather than deleting them.
6. **A closed business date is frozen.** `lib/dayclose.ts` `assertDayOpen(station, date)` is
   called by every mutating route in shifts, density, finance, inventory, lubricants,
   attendance and readings. Reopening requires a reason and is audited (the "roznamcha"
   rule).
7. **Prices are history.** Reading a rate resolves station-specific → tenant → date window,
   so yesterday's report still shows yesterday's price.

## Trust boundaries

- **AuthN**: session cookie (`sessions` table stores only a SHA-256 hash of the token),
  12 h TTL, SameSite=Lax (partitioned in embedded previews), `COOKIE_SECURE` required in
  production, login and password routes rate-limited separately.
- **AuthZ**: `packages/shared/permissions.ts` defines fine-grained permissions; roles are
  bundles of them. Two business roles exist by design — `OWNER` (everything in the tenant)
  and `MANAGER` (daily operations at assigned stations), plus an internal `SUPER_ADMIN`.
  Checks run **server-side in every route**; hiding a nav item is never the control.
  `user_station_access` narrows a manager to specific pumps and can only subtract.
- **Multi-tenancy**: `lib/tenant.ts` resolves the caller's tenant and the station ids they
  may touch, and every query filters on them. Cross-tenant reads are structurally impossible
  because the id is taken from the session, not the request.
- **Devices**: `X-Device-Key` (hashed at rest, rotatable, versioned) — not a session.
  Ingest is idempotent via `idempotency_keys` + `eventId` dedupe, so a gateway replaying its
  spool after an outage cannot double-count litres.
- **Input**: zod schemas on every body/query (`lib/http.ts` `parse`); unknown settings keys
  are rejected by an allow-list (`lib/settings.ts`).
- **Honesty labels**: demo rows carry `is_demo`, simulated readings keep their source, and
  `HARDWARE_DISCLAIMER`/`ACCOUNTING_DISCLAIMER` are returned with report payloads so nobody
  mistakes operational estimates for audited statements.

## Frontend

React 18 + Vite + Tailwind, no component library. Route-level `React.lazy` per screen
(`App.tsx`), TanStack Query for server state (queries keyed by station), and a single
`lib/api.ts` client that speaks relative `/api/v1` paths.

**Theming is token-only.** `index.css` declares semantic CSS custom properties
(`navy-*` surfaces, `ink-*` text, `accent*`, `panel-*` brand ink, `ok/warn/danger/info`)
as space-separated RGB channels so Tailwind's `/opacity` modifiers keep working.
`tailwind.config.js` maps them to utility classes; components never reference a raw shade.
Switching `data-theme` on `<html>` re-tints everything, including Recharts (whose palettes
live in `lib/theme.tsx` because SVG attributes cannot resolve CSS variables).

## Gateway

A separate process that a pump runs on its own LAN: polls a controller adapter, pushes
NDJSON events to the API, and appends every event to a durable local spool
(`gateway/src/spool.ts`) so an ISP outage loses nothing. `adapters/simulated.ts` is verified;
`adapters/modbusTcp.ts` is a scaffold that throws until a real register map is certified.
Config sync uses `GATEWAY_SYNC_TOKEN`.

## Deliberate limits

- **Single-writer SQLite.** `node:sqlite` is experimental and the file is local: run **one**
  app instance per database file. Horizontal scale needs a shared-server adapter first —
  the MySQL variables in `.env.example` are aspirational, there is no MySQL adapter.
- No email/SMS/WhatsApp delivery, no background job queue, no offline PWA. Alerts are computed
  live and shown in-app; `docs/ADD-BACKLOG.md` §7 tracks the notification engine design.
- Payroll, tax returns and hardware certification are out of scope today; see the gap report.
