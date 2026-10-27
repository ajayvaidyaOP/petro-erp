import { defineConfig } from '@playwright/test';

// These servers use a dedicated database and ports; they never reset the user's
// development database. The test database is recreated once per test run.
const apiPort = 4101;
const webPort = 5174;
const origin = `http://127.0.0.1:${webPort}`;
const browserExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
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
      command: 'npm run db:reset && npm run start -w @petroflow/server',
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      timeout: 90_000,
      reuseExistingServer: false,
      env: {
        DATABASE_FILE: 'db/e2e-petroflow.db',
        NODE_ENV: 'development',
        PORT: String(apiPort),
        HOST: '0.0.0.0',
        APP_ORIGIN: origin,
        ALLOWED_ORIGINS: origin,
        COOKIE_SECURE: 'false',
        ENABLE_DEMO_TOOLS: 'true',
        DEMO_PASSWORD: 'PetroFlow@2025',
        SEED_DEMO_DATA: 'true',
        LOGIN_RATE_LIMIT_MAX: '200',
        LOG_LEVEL: 'silent',
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
