# PetroFlow ERP

Full-stack petrol pump ERP: React frontend, Express API and SQLite database.
Requires Node.js 22.13+ (uses built-in `node:sqlite`).

## Single-server testing preview

```sh
npm ci
npm run build
npm run start -w @petroflow/server
```

Open port **4000**. This serves the built frontend and `/api/v1` backend
on the same origin. There is no separate browser API URL to configure.
An empty development database is automatically populated with demo records.

Demo owner: `owner@sunrisefuels.in`
Demo platform administrator: `superadmin@petroflow.dev`
Demo password: `PetroFlow@2025`

Use demo data only on public development previews. Development allows iframe
embedding so the app works inside Arena's preview. Production retains
`X-Frame-Options: SAMEORIGIN`.

## Development

`npm run dev` runs the API on 4000 and Vite on 5173. Open 5173; Vite
proxies relative `/api` requests to the backend.

## Verification

```sh
npm test
npm run typecheck
npm run build
```

## Configuration and data

See `.env.example`. Optional local overrides belong in an ignored `.env` file.
Development data is stored in `db/petroflow.db` (ignored by Git).
Do not run database reset commands unless you intend to erase local data.

This is not a production deployment guide. Before production, review dependency
security findings, configure HTTPS, secure session cookies, explicit public
origins and backups, disable demo tools, and provision non-demo accounts.
