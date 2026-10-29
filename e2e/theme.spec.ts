import { expect, test } from '@playwright/test';

test('the responsive overview keeps its chart, theme and navigation usable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/login');
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

  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('img', { name: /7-day estimated sales chart/ }).locator('svg')).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.viewport);

  await page.getByRole('navigation', { name: 'Quick navigation' }).getByRole('button', { name: 'More' }).click();
  const menu = page.getByRole('dialog', { name: 'Navigation menu' });
  await expect(menu).toBeVisible();
  await menu.getByRole('link', { name: 'Stock & deliveries' }).click();
  await expect(page).toHaveURL(/\/tanks$/);
  await expect(page.getByRole('heading', { name: 'Tanks & fuel stock' })).toBeVisible();
});
