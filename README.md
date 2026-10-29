# PetroFlow ERP

Petrol-pump operations ERP with a React + Vite frontend, Express API, hardware gateway, shared TypeScript package, and SQLite schema/data at the repository root.

## One owner. One manager.

The business workspace now has **two fixed roles and at most one active account per role**:

| Role | Responsibility |
| --- | --- |
| **Owner** | Business overview, prices, finance, reports, team access, pump setup and subscription. |
| **Manager** | Day-to-day shifts/readings, stock/deliveries, sales/credit, payments/expenses, reconciliation and reports for assigned pumps. No team, price or configuration changes. |

The primary navigation is reduced to **Overview, Shifts & readings, Stock & deliveries, Sales & credit, Finance, Reports, Team and Settings**. Specialist screens are contextual tabs inside those sections; the manager sees only the six sections they can use. Advanced setup/diagnostics are collapsed in Settings. The dashboard defaults to the selected pump, with an optional owner-only comparison. Quick actions open the shift/delivery/expense entry forms directly.

The platform administrator is an internal maintenance account, not a third pump role, and has no client demo tile.

### Upgrading an existing database

Boot applies additive migrations and consolidates access without deleting business records. It keeps the earliest active owner and manager, disables surplus active accounts, revokes their sessions and writes `TEAM_ACCESS_CONSOLIDATED` audit entries. Retired role identities and historical references are preserved; old staff are **not** silently promoted. A partial unique index prevents duplicate active owners/managers. If no manager remains, the owner can use **Team → Set up manager**; a disabled manager can be re-enabled instead of creating another account. Back up existing data before upgrading. Station permission overrides cannot grant permissions outside the fixed role.

## Repository layout

```text
petro-erp/
├── frontend/          # React + Vite application
├── backend/           # Node.js + Express API, tests, SQLite adapter
├── gateway/           # Local hardware gateway and simulator
├── packages/
│   └── shared/         # Shared constants, types, and permissions
├── db/                 # SQLite schema and ignored local database files
├── package.json        # Root npm workspaces and commands
├── package-lock.json
└── README.md
```

## Petrol-pump audit & roadmap

Three domain documents live in `docs/`:

| Doc | What it answers |
| --- | --- |
| `docs/ARCHITECTURE.md` | How the four workspaces fit together, and the domain rules (meters → stock → shifts → day close) |
| `docs/OPERATIONS.md` | Runbook: first run, backups, restore, health checks, disaster recovery |
| `docs/PETROL-PUMP-ERP-GAP-REPORT.md` | What an Indian petrol pump ERP/CRM needs, what this repo has, what is missing |
| `docs/ADD-BACKLOG.md` | The missing pieces as build-ready specs (tables, endpoints, files to touch, effort) |
| `docs/PETROL-PUMP-ERP-AUDIT.md` | Earlier audit (28 Oct) — still useful, but several of its ❌ items are now built; see §5 of the gap report for corrections | **Phases 1–3 of that roadmap are now
implemented** (Oct 2026):

- **Forecourt truth:** every nozzle is hard-mapped to its tank (no pro-rata guessing), testing litres
  are netted out of sales, and tank stock moves only through the ledger.
- **Shift hisaab:** note-wise cash counting (₹500 → ₹1), mode-wise settlement (Cash/UPI/Card/Bank/Credit)
  with automatic short/excess, and a day-closing lock that freezes a finished business date.
- **Quality & law:** daily density register with 15°C correction + BIS spec flag, full TT decantation
  record (dip before/after, seals, sample, chambers), and Licence & Compliance expiry alerts
  (PESO, W&M stamping, Fire NOC, tank testing…) on the dashboard.
- **Stock wisdom:** monthly stock loss/gain vs oil-company norms (MS 0.75% / HSD 0.25%), water dip,
  and indent suggestions (days-of-cover + safe ullage) per tank.
- **Udhaar control:** vehicle-wise credit slips with auto slip numbers, printable monthly customer
  statements, and a FIFO ageing report (0–30/31–60/61–90/90+).
- **Counter business:** lubricant SKU stock & sales (GST-ready), two-person team attendance with payable-days,
  and one-click CSV exports (sales register, stock statement, ageing, lubricants GST).

Existing databases migrate automatically on boot (additive columns/tables + role sync).

## Theming

The UI is a **token-only "Forecourt Lux" system**: deep petrol jade as the brand colour, a warm
sage-paper canvas in light mode, a green-graphite ink in dark mode, and amber-gold reserved as the
"energy" highlight (rates, litres, revenue moments). Locally bundled Manrope display type + Inter
body text, responsive sidebar/drawer/bottom navigation, keyboard-accessible dialogs. Light is the
default; dark mode remains available. Nothing in a component references a raw Tailwind shade — every
colour resolves through CSS custom properties in `frontend/src/index.css`, exposed to Tailwind in
`frontend/tailwind.config.js`, so switching `data-theme` on `<html>` re-tints all 32 screens:

| Token family | Meaning |
| --- | --- |
| `navy-*` | Surfaces (`950` page canvas → `600` strongest border) |
| `ink-*` | Text (`100` strongest → `600` faintest) |
| `accent*` | Brand colour |
| `onaccent` | Foreground on brand-coloured surfaces |
| `scrim` | Modal/drawer backdrop — always dark in both themes |
| `inset` | Recessed surface for code blocks and inset panels |
| `ok` / `warn` / `danger` / `info` | Status colours (invert with the theme to stay legible) |
| `onaccent` / `onok` / `onwarn` / `ondanger` | Foreground for text on a solid status fill |
| `energy` / `accent-energy` | Amber-gold fuel highlight — rates, litres, positive revenue |
| `panel-*` | Brand ink panel (login split) — deliberately dark in **both** themes |
| `chart-1…5` | Chart series; Recharts mirrors the same values in `frontend/src/lib/theme.tsx` |

Shadows and radii are tokens too (`shadow-card`, `shadow-card-hover`, `shadow-sheen`, `shadow-pop`,
`shadow-glow`, `rounded-2.5xl`), and the page canvas carries three faint radial washes for depth.
Chart colours live in `lib/theme.tsx` because SVG attributes cannot resolve CSS variables — keep
those hexes in step with `index.css` when the palette changes.

Users switch from the sun/moon button in the header. The choice is stored in
`localStorage` under `petroflow.theme`; with no stored choice the readable
light workspace is used. An inline script in `index.html` applies the theme
before first paint so there is no flash of the wrong palette.

Avoid re-introducing fixed Tailwind shades for text on themed surfaces (for example
`text-emerald-300`), which read well on dark cards but are unreadable on white — use the
status tokens instead. The same applies to `navy-*` for anything other than a surface.

## Requirements

- Windows 10/11 (or another supported Node.js platform).
- Node.js **22.13.0 or newer** and the npm version bundled with it. The backend uses Node's built-in `node:sqlite`.
- Visual Studio Code (recommended).

## Windows + VS Code: local development

Open PowerShell and clone/open the repository:

```powershell
git clone https://github.com/ajayvaidyaOP/petro-erp.git
cd petro-erp
code .
```

In VS Code, open **Terminal → New Terminal** (PowerShell), then run:

```powershell
node --version
npm --version
npm ci
```

Optional: create a local environment file for overrides. `.env` is ignored by Git; the defaults work without it.

```powershell
Copy-Item .env.example .env
```

Start the API and Vite development server together from the repository root:

```powershell
npm run dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the Express server on port **4000**. The browser uses same-origin relative `/api/v1/...` requests—no browser-side localhost API URL is configured. The API health check is at **http://localhost:4000/api/v1/health**.

On the first non-production start, an empty database is created at `db/petroflow.db` and populated with demo records. Demo sign-in:

The demo tenant **Sunrise Fuels** runs two outlets (Baner and Hinjewadi) with separate nozzles, tanks, shifts, deliveries and reconciliations, so multi-station behaviour can be reviewed without any setup. Switch between outlets from the station picker in the header (or the mobile menu) and compare both on the dashboard.

- Owner (both pumps): `owner@sunrisefuels.in` — Rohit Deshmukh
- Manager (both pumps): `manager@sunrisefuels.in` — Anjali Kulkarni
- Password: `PetroFlow@2025` (or the `DEMO_PASSWORD` in your ignored `.env`)

The dashboard defaults to the pump selected in the header. The owner can choose **Compare both pumps** for a combined overview and select both pumps in DSR/CSV exports. Sales figures are estimates from closed or flagged shift totalizers, not audited revenue. Customer accounts and balances are company-wide; the manager can post credit slips and review the ledger at assigned pumps.

The new demo layout is seeded **only into an empty database**. Existing databases are never reset or stripped of companies/records automatically; surplus active accounts lose access as described above, and the owner sets up a manager if needed. If an old demo database is no longer needed, back it up first; `npm run db:reset` is destructive and is the explicit way to create a fresh demo. Existing customer and accounting data is not deleted on upgrade.

These are development-only credentials. Do not expose a local/demo instance as a public service.

Useful root commands (run from the repository root):

```powershell
npm run dev                 # frontend + backend
npm run dev:frontend        # Vite only
npm run dev:backend         # Express API only
npm run dev:gateway         # requires a registered device key in .env
npm test                    # API, authorization, and meter tests
npm run test:e2e            # browser workflows (install Chromium first; see below)
npm run typecheck           # shared, backend, frontend, and gateway
npm run build               # frontend production assets + backend type/build check
npm run db:seed             # seed demo records if the database is empty
npm run db:backup           # verified snapshot into db/backups/ (+ sha256 sidecar, retention prune)
npm run db:integrity        # check the live database and the newest snapshot
npm run db:mysql-ddl        # regenerate db/mysql/schema.sql from db/schema.sql (review before use)
npm run db:reset            # DESTRUCTIVE: delete the local SQLite DB and re-seed it
```

### Automated checks

`npm test` uses the separate ignored `db/test-petroflow.db` (legacy authorization tests explicitly create their own multi-tenant fixture; the two-pump tests exercise the actual default seed); it does not reset `db/petroflow.db`. Do not run `npm run db:reset` if you need to keep your local data.

For browser checks, install Playwright's Chromium once, then run:

```powershell
npx playwright install chromium
npm run test:e2e
```

The browser suite starts its own API and Vite servers on ports **4101** and **5174** and resets only the dedicated ignored `db/e2e-petroflow.db`. It covers login/logout (including an embedded HTTPS preview with third-party cookies blocked), two-role navigation, station switching, pagination, customer/credit and expense entry, direct quick actions, keyboard focus in nested dialogs, simulated device events, gateway registration, shift preview/edit/close, combined reports, and mobile layouts in both themes. These are automated checks against demo data, not a substitute for production acceptance testing or commissioning real forecourt hardware. In restricted environments, `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can point to an existing compatible Chromium binary.

Development HTTPS previews use secure, partitioned session cookies so login works inside an embedded preview without enabling ordinary third-party cookies. Localhost and production sessions retain `SameSite=Lax`. If a browser does not support embedded session cookies, use **Open preview in a new tab** on the sign-in screen.

## Single-server local run

To verify the built SPA and API on one origin:

```powershell
npm ci
npm run build
npm run start
```

Open **http://localhost:4000**. Express serves `frontend/dist` and `/api/v1` from the same server; the frontend still calls the API through relative `/api` paths. This is a local run, **not a public deployment**.

## Deployment requirements and limits

This repository does not deploy itself. A real production deployment needs an intentionally configured host/reverse proxy, HTTPS/TLS, firewalling, monitoring, secure secret management, and tested backups/restores. At minimum:

- Use Node.js 22.13+ and build with `npm ci` followed by `npm run build`; start the backend with `npm run start`.
- Set `NODE_ENV=production`, `COOKIE_SECURE=true`, an explicit `SESSION_COOKIE_NAME`, the public HTTPS `APP_ORIGIN`, and exact `ALLOWED_ORIGINS`. Set `ENABLE_DEMO_TOOLS=false`; do not use demo accounts/passwords or run the demo seed against production data. Production startup fails fast if required security settings are missing.
- Put `DATABASE_FILE` on a durable, writable, backed-up disk. SQLite is the database adapter implemented here; run one application instance against that file. Do not use ephemeral storage or horizontally scale multiple writers against a local SQLite file. The commented MySQL variables in `.env.example` do not enable a MySQL adapter; `npm run db:mysql-ddl` regenerates `db/mysql/schema.sql` for a future migration, and that file must be reviewed (it is generated, not battle-tested).
- If TLS is terminated by a trusted reverse proxy, configure `TRUST_PROXY=true` only for that deployment topology. Restrict public origins and network access to the API and database volume.
- Snapshots are taken with `VACUUM INTO` (`npm run db:backup`), integrity-checked and hash-sided; copy them off the pump's disk daily and **test a restore** (`npm run db:restore -- --from <snapshot> --yes`) on a spare machine before go-live. See `docs/OPERATIONS.md`.
- Run `npm audit` and resolve any findings before go-live. The lockfile reported zero vulnerabilities when last checked; advisories can change, so repeat the audit as part of deployment.
- Development-only Vite host allowances and iframe relaxation are not part of production serving. The production Express app retains `X-Frame-Options: SAMEORIGIN`; do not weaken it to make a public site embeddable.

For multi-instance/high-availability production, a supported shared database adapter and deployment-specific migration/backup plan are required first. Do not treat `npm run dev`, `vite preview`, or the local single-server command above as a public launch.
