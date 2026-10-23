# PetroFlow ERP

Petrol-pump operations ERP with a React + Vite frontend, Express API, hardware gateway, shared TypeScript package, and SQLite schema/data at the repository root.

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

- Owner: `owner@sunrisefuels.in`
- Platform administrator: `superadmin@petroflow.dev`
- Password: `PetroFlow@2025` (or the `DEMO_PASSWORD` in your ignored `.env`)

These are development-only credentials. Do not expose a local/demo instance as a public service.

Useful root commands (run from the repository root):

```powershell
npm run dev                 # frontend + backend
npm run dev:frontend        # Vite only
npm run dev:backend         # Express API only
npm run dev:gateway         # requires a registered device key in .env
npm test                    # API and meter tests
npm run typecheck           # shared, backend, frontend, and gateway
npm run build               # frontend production assets + backend type/build check
npm run db:seed             # seed demo records if the database is empty
npm run db:reset            # DESTRUCTIVE: delete the local SQLite DB and re-seed it
```

`npm test` uses the separate ignored `db/test-petroflow.db`; it does not reset `db/petroflow.db`. Do not run `npm run db:reset` if you need to keep your local data.

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
- Put `DATABASE_FILE` on a durable, writable, backed-up disk. SQLite is the database adapter implemented here; run one application instance against that file. Do not use ephemeral storage or horizontally scale multiple writers against a local SQLite file. The commented MySQL variables in `.env.example` do not enable a MySQL adapter.
- If TLS is terminated by a trusted reverse proxy, configure `TRUST_PROXY=true` only for that deployment topology. Restrict public origins and network access to the API and database volume.
- Run `npm audit` and resolve the findings before go-live. The current lockfile reports 15 findings overall, including two moderate production-dependency findings; this refactor does not upgrade dependencies across major versions.
- Development-only Vite host allowances and iframe relaxation are not part of production serving. The production Express app retains `X-Frame-Options: SAMEORIGIN`; do not weaken it to make a public site embeddable.

For multi-instance/high-availability production, a supported shared database adapter and deployment-specific migration/backup plan are required first. Do not treat `npm run dev`, `vite preview`, or the local single-server command above as a public launch.
