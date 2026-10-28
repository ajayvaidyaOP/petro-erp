import { test as base, expect, type Page } from '@playwright/test';

type BrowserMonitor = { allow: (method: string, path: string, status: number) => void };

// Fail tests on uncaught React errors and unexpected API failures, not just on
// visible text. Individual tests can explicitly allow a negative-path response.
const test = base.extend<{ monitor: BrowserMonitor }>({
  monitor: [async ({ page }, use) => {
    const errors: string[] = [];
    const allowed = new Set<string>();
    let authenticated = false;
    page.on('pageerror', (error) => errors.push(`Browser: ${error.message}`));
    page.on('response', (response) => {
      const url = new URL(response.url());
      const method = response.request().method();
      if (method === 'POST' && url.pathname === '/api/v1/auth/login' && response.ok()) authenticated = true;
      if (method === 'POST' && url.pathname === '/api/v1/auth/logout' && response.ok()) authenticated = false;
      // The application intentionally probes for an existing session on first load.
      if (!authenticated && method === 'GET' && url.pathname === '/api/v1/auth/me' && response.status() === 401) return;
      if (!url.pathname.startsWith('/api/') || response.status() < 400) return;
      const key = `${method} ${url.pathname} ${response.status()}`;
      if (!allowed.has(key)) errors.push(`API: ${key}${url.search}`);
    });
    await use({ allow: (method, path, status) => allowed.add(`${method} ${path} ${status}`) });
    expect(errors, errors.join('\n')).toEqual([]);
  }, { auto: true }],
});

const owner = 'owner@sunrisefuels.in';

async function demoLogin(page: Page, email = owner) {
  await page.goto('/login');
  if (email === 'superadmin@petroflow.dev') {
    await page.getByLabel('Email').fill(email);
    await page.locator('input[type="password"]').fill('PetroFlow@2025');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  } else {
    await page.getByRole('button', { name: new RegExp(email.replace('.', '\\.')) }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible();
}

async function waitForPage(page: Page) {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByText('Something went wrong', { exact: true })).toHaveCount(0);
}

test('login rejects bad credentials, accepts valid credentials and signs out', async ({ page, monitor }) => {
  monitor.allow('POST', '/api/v1/auth/login', 401);
  await page.goto('/login');
  await expect(page.getByRole('button', { name: /owner@sunrisefuels\.in/ })).toBeVisible();
  await page.getByLabel('Email').fill(owner);
  await page.locator('input[type="password"]').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/invalid|incorrect/i);
  await page.locator('input[type="password"]').fill('PetroFlow@2025');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible();
  await page.locator('button[aria-haspopup="menu"]').click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('embedded HTTPS preview keeps its session when third-party cookies are blocked', async ({ page, context }) => {
  const preview = 'https://5173-sandbox.e2b.app';
  await page.route('https://arena.invalid/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<iframe style="width:100%;height:900px" src="${preview}/login"></iframe>`,
  }));
  // Emulate the HTTPS preview proxy without sharing Playwright's API cookie jar:
  // only cookies actually sent by the embedded browser reach the local server.
  await page.route(`${preview}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = await request.allHeaders();
    headers.host = url.host;
    headers['x-forwarded-host'] = url.host;
    delete headers['content-length'];
    delete headers['accept-encoding'];
    const response = await fetch(`http://127.0.0.1:5174${url.pathname}${url.search}`, {
      method: request.method(),
      headers,
      body: request.postDataBuffer() ?? undefined,
      redirect: 'manual',
    });
    const responseHeaders = Object.fromEntries(response.headers.entries());
    delete responseHeaders['transfer-encoding'];
    delete responseHeaders['content-encoding'];
    delete responseHeaders['content-length'];
    await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) });
  });
  // The synthetic HTTPS host has no live HMR socket; stub it, not app API calls.
  await page.routeWebSocket(/wss:\/\/5173-sandbox\.e2b\.app.*/, (socket) => socket.send('{"type":"connected"}'));
  await page.goto('https://arena.invalid/');
  const frame = page.frameLocator('iframe');
  await frame.getByLabel('Email').fill('superadmin@petroflow.dev');
  await frame.locator('input[type="password"]').fill('PetroFlow@2025');
  await frame.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(frame.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible();
  const cookie = (await context.cookies()).find((item) => item.name === 'pf_session' && item.domain === '5173-sandbox.e2b.app');
  expect(cookie).toMatchObject({ secure: true, sameSite: 'None' });
  await page.reload();
  await expect(frame.getByRole('navigation', { name: 'Primary' }).first()).toBeVisible();
  await frame.locator('button[aria-haspopup="menu"]').click();
  await frame.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(frame.getByLabel('Email')).toBeVisible();
});

for (const [role, email] of [
  ['owner', owner],
  ['pump 1 staff', 'staff1@sunrisefuels.in'],
  ['pump 2 staff', 'staff2@sunrisefuels.in'],
  ['platform admin', 'superadmin@petroflow.dev'],
] as const) {
  test(`${role}: every visible navigation screen loads without browser or API errors`, async ({ page }) => {
    await demoLogin(page, email);
    const nav = page.getByRole('navigation', { name: 'Primary' }).first();
    const paths = await nav.locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter((href): href is string => Boolean(href)));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      await nav.locator(`a[href="${path}"]`).first().click();
      await waitForPage(page);
    }

  });
}

test('station selection follows navigation and drives station-scoped queries', async ({ page }) => {
  await demoLogin(page);
  const station = page.locator('select[aria-label="Active station"]:visible');
  const options = await station.locator('option').evaluateAll((elements) => elements.map((element) => ({ value: element.value, label: element.textContent })));
  expect(options.length).toBeGreaterThan(1);
  const other = options.find((option) => option.value !== '')!;
  const current = await station.inputValue();
  const next = options.find((option) => option.value !== current) ?? other;
  const dashboardResponse = page.waitForResponse((response) => response.url().includes(`/reports/owner-dashboard?stationId=${next.value}`));
  await station.selectOption(next.value);
  expect((await dashboardResponse).status()).toBe(200);
  await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link', { name: /Payments & Expenses/i }).click();
  await waitForPage(page);
  await expect(station).toHaveValue(next.value);
  const response = await page.request.get(`/api/v1/finance/expenses?stationId=${next.value}`);
  expect(response.status()).toBe(200);
});

test('customer creation and paginated lists preserve server totals', async ({ page }) => {
  await demoLogin(page);
  // Populate enough isolated test records to exercise the Next page button.
  for (let i = 0; i < 16; i += 1) {
    const res = await page.request.post('/api/v1/catalog/customers', {
      data: { code: `E2E-${String(i).padStart(2, '0')}`, name: `Browser Test ${String(i).padStart(2, '0')}` },
    });
    expect(res.status()).toBe(201);
  }
  await page.goto('/customers');
  await page.getByPlaceholder('Search name, code, phone…').fill('Browser Test');
  await expect(page.getByText('Page 1 / 2')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next page' })).toBeEnabled();
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  await expect(page.getByText('Browser Test 15')).toBeVisible();
  await page.getByRole('button', { name: 'New customer' }).click();
  const dialog = page.getByRole('dialog', { name: 'New credit customer' });
  await dialog.getByLabel('Customer code').fill('E2E-UI');
  await dialog.getByLabel(/^Name/).fill('Browser UI Customer');
  await dialog.getByRole('button', { name: 'Create customer' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Customer created')).toBeVisible();
});

test('recording an expense shows it in the expenses list', async ({ page }) => {
  await demoLogin(page);
  await page.goto('/finance');
  await page.getByRole('tab', { name: 'Expenses' }).click();
  await page.getByRole('button', { name: 'Add expense' }).click();
  const dialog = page.getByRole('dialog', { name: 'Record expense' });
  await dialog.getByLabel('Description').fill('Browser test electricity bill');
  await dialog.getByLabel('Amount (INR)').fill('123.45');
  await dialog.getByRole('button', { name: 'Save expense' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Expense recorded')).toBeVisible();
  await expect(page.getByText('Browser test electricity bill')).toBeVisible();
});

test('simulator and device registration work across Devices and Dispensers', async ({ page }) => {
  await demoLogin(page);
  await page.goto('/devices');
  await page.getByRole('button', { name: 'Inject simulated reading' }).click();
  await expect(page.getByText('Simulated events injected')).toBeVisible();
  await page.getByRole('button', { name: 'Register gateway' }).click();
  const dialog = page.getByRole('dialog', { name: 'Register gateway' });
  await dialog.getByLabel('Code').fill('E2E-REAL');
  await dialog.getByLabel(/^Name/).fill('Browser controller');
  await dialog.getByLabel('Device type').selectOption('CONTROLLER');
  await dialog.getByRole('combobox', { name: /^Mode/ }).selectOption('REAL');
  await dialog.getByRole('button', { name: 'Register', exact: true }).click();
  const keyDialog = page.getByRole('dialog', { name: 'Device key issued' });
  await expect(keyDialog).toBeVisible();
  await keyDialog.getByRole('button', { name: 'I have stored this key' }).click();
  const row = page.getByRole('row').filter({ hasText: 'Browser controller' });
  await expect(row).toContainText('REAL · UNVERIFIED');
  await page.getByRole('navigation', { name: 'Primary' }).first().getByRole('link', { name: 'Dispensers & Nozzles' }).click();
  await waitForPage(page);
});

test('shift preview, manual edit and close use the saved reading', async ({ page }) => {
  await demoLogin(page);
  await page.goto('/shifts');
  const openRow = page.locator('tbody tr').filter({ has: page.getByRole('cell', { name: 'OPEN', exact: true }) }).first();
  await openRow.getByRole('button', { name: 'View' }).click();
  const detail = page.getByRole('dialog', { name: /^Shift #/ });
  await detail.getByRole('button', { name: 'Preview closing readings' }).click();
  await expect(detail.getByText('Closing preview')).toBeVisible();
  await detail.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const edit = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Save readings' }) });
  const opening = edit.getByLabel('Opening totalizer');
  let openingValue = await opening.inputValue();
  if (!openingValue) {
    openingValue = '100';
    await opening.fill(openingValue);
  }
  const manualClosing = (Number(openingValue) + 5).toFixed(3);
  await edit.getByLabel('Closing totalizer').fill(manualClosing);
  await edit.getByRole('button', { name: 'Save readings' }).click();
  await expect(edit).toBeHidden();
  await detail.getByRole('button', { name: 'Close shift', exact: true }).click();
  const closeDialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Close & compute' }) });
  const responsePromise = page.waitForResponse((response) => /\/api\/v1\/shifts\/[^/]+\/close$/.test(response.url()) && response.request().method() === 'POST');
  await closeDialog.getByRole('button', { name: 'Close & compute' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body.data.nozzles.some((nozzle: { closingReading: string }) => nozzle.closingReading === manualClosing)).toBe(true);
  await expect(closeDialog).toBeHidden();
  await expect(detail.getByText(/closed|flagged/i).first()).toBeVisible();
});

for (const email of [owner, 'staff1@sunrisefuels.in', 'staff2@sunrisefuels.in']) {
  test(`${email}: navigation screens fit a 360px phone in both themes`, async ({ page }) => {
    await demoLogin(page, email);
    const paths = await page.getByRole('navigation', { name: 'Primary' }).first().locator('a').evaluateAll((links) => links.map((link) => link.getAttribute('href')).filter((href): href is string => Boolean(href)));
    await page.setViewportSize({ width: 360, height: 780 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => { localStorage.setItem('petroflow.theme', value); document.documentElement.dataset.theme = value; }, theme);
      for (const path of paths) {
        await page.goto(path);
        await waitForPage(page);
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth }));
        expect(dimensions.scroll, `${path} ${theme}`).toBeLessThanOrEqual(dimensions.viewport);
      }
    }
  });
}

test('staff can enter a credit slip without seeing the company ledger', async ({ page }) => {
  await demoLogin(page, 'staff1@sunrisefuels.in');
  await page.goto('/customers');
  await page.getByRole('button', { name: 'Credit slip' }).first().click();
  const dialog = page.getByRole('dialog', { name: /Credit sale/ });
  await expect(dialog.getByRole('button', { name: 'Post credit sale' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /credit ledger/ })).toHaveCount(0);
});

test('owner can switch combined DSR and export both pump registers', async ({ page }) => {
  await demoLogin(page);
  await expect(page.getByText('Dono Pump · Owner overview')).toBeVisible();
  await page.goto('/reports');
  await page.getByLabel('Report pump').selectOption('all');
  await expect(page.getByText('Dono Pump · Combined')).toBeVisible();
  for (const label of ['Sales Register', 'Stock Statement']) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: new RegExp(label) }).click();
    expect((await download).suggestedFilename()).toContain('.csv');
  }
});
