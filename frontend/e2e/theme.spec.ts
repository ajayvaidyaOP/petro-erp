import { expect, test } from '@playwright/test';

test('the responsive overview keeps its chart, theme and navigation usable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0a0c0b');
  const palette = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return { accent: styles.getPropertyValue('--accent').trim(), success: styles.getPropertyValue('--ok').trim() };
  });
  expect(palette).toEqual({ accent: '255 145 69', success: '84 216 142' });
  await page.getByRole('button', { name: /owner@sunrisefuels\.in/ }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.getByText('Current fuel rates')).toBeVisible();

  const salesChart = page.getByRole('img', { name: /7-day estimated sales chart/ });
  await expect(salesChart).toBeVisible();
  await expect(salesChart.locator('svg')).toBeVisible();
  await expect(salesChart).toHaveAttribute('aria-label', /\d{2}-\d{2}: ₹/);
  expect((await salesChart.boundingBox())?.height).toBeGreaterThanOrEqual(240);

  await page.getByRole('button', { name: 'Litres', exact: true }).click();
  await page.getByRole('button', { name: '14d', exact: true }).click();
  await expect(page.getByRole('img', { name: /14-day estimated fuel volume chart/ })).toHaveAttribute(
    'aria-label',
    /\d{2}-\d{2}: [\d,.]+ L/,
  );

  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('img', { name: /7-day estimated sales chart/ }).locator('svg')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Reports should remain readable on paper even though the workspace is dark.
  await page.emulateMedia({ media: 'print' });
  const printColors = await page.locator('.stat-card').first().evaluate((card) => ({
    background: getComputedStyle(card).backgroundColor,
    text: getComputedStyle(card.querySelector('p')!).color,
  }));
  expect(printColors.background).toBe('rgb(255, 255, 255)');
  expect(printColors.text).toBe('rgb(92, 99, 91)');
  await page.emulateMedia({ media: 'screen' });

  for (const width of [320, 360, 768, 1024]) {
    await page.setViewportSize({ width, height: 780 });
    const dimensions = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: document.documentElement.clientWidth,
    }));
    expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);
  }
  await page.setViewportSize({ width: 360, height: 780 });

  await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Stock & deliveries' }).click();
  await expect(page).toHaveURL(/\/tanks$/);
  await expect(page.getByRole('heading', { name: 'Tanks & fuel stock' })).toBeVisible();
});

test('a saved light preference is respected on the login screen', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('petroflow.theme', 'light'));
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f4f3ef');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
});

test('password visibility does not change the field label', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('example-password');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
});

test('dashboard shortcuts respect the current login permissions', async ({ page }) => {
  await page.route('**/api/v1/auth/me', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    body.data.permissions = ['reports.read', 'shifts.read'];
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/v1/reports/owner-dashboard?*', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const body = await response.json();
    body.data.openShifts = [];
    body.data.flaggedShifts = 0;
    await route.fulfill({ response, json: body });
  });

  await page.goto('/login');
  await page.getByRole('button', { name: /owner@sunrisefuels\.in/ }).click();
  const shortcuts = page.getByRole('region', { name: 'Quick actions' });
  await expect(shortcuts.getByRole('link', { name: /View shifts/ })).toBeVisible();
  await expect(shortcuts.getByRole('link', { name: /Record delivery|Add expense|Customer credit/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open shift', exact: true })).toHaveCount(0);
});
