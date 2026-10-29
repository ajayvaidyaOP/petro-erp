import { defineConfig } from '@playwright/test';

// E2E tests run against the Java 21 API + dedicated MySQL test schema (petroflow_e2e)
// so they never touch the developer's main database.
const apiPort = 4101;
const webPort = 5174;
const origin = `http://127.0.0.1:${webPort}`;
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './frontend/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: origin,
    actionTimeout: 12_000,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: {
      ...(browserExecutable ? { executablePath: browserExecutable } : {}),
      // Exercise embedded previews with third-party cookie restrictions enabled.
      args: ['--test-third-party-cookie-phaseout', ...(browserExecutable ? ['--no-sandbox', '--no-zygote'] : [])],
    },
  },
  webServer: [
    {
      command: 'node scripts/start-e2e-api.mjs',
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        NODE_ENV: 'development',
        PORT: String(apiPort),
        HOST: '0.0.0.0',
        MYSQL_HOST: process.env.MYSQL_HOST ?? '127.0.0.1',
        MYSQL_PORT: process.env.MYSQL_PORT ?? '3306',
        MYSQL_DATABASE: process.env.E2E_MYSQL_DATABASE ?? 'petroflow_e2e',
        MYSQL_USER: process.env.MYSQL_USER ?? 'root',
        MYSQL_PASSWORD: process.env.MYSQL_PASSWORD ?? '',
        APP_ORIGIN: origin,
        COOKIE_SECURE: 'false',
        ENABLE_DEMO_TOOLS: 'true',
        DEMO_PASSWORD: 'PetroFlow@2025',
        SEED_DEMO_DATA: 'true',
      },
    },
    {
      command: `npm run dev -w @petroflow/web -- --port ${webPort} --strictPort`,
      url: origin,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        PETROFLOW_API_URL: `http://127.0.0.1:${apiPort}`,
        PETROFLOW_HMR_CLIENT_PORT: String(webPort),
      },
    },
  ],
});
