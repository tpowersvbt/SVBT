import { test, expect } from '@playwright/test';

test('public site, portrait, mobile sector dialog and genuine WebGL canvas', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Built for what/ })).toBeVisible();
  await page.locator('#leadership').scrollIntoViewIfNeeded();
  const portrait = page.locator('.leadership-portrait');
  await expect(portrait).toBeVisible();
  await expect.poll(() => portrait.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.locator('.hero').scrollIntoViewIfNeeded();
  await expect(page.locator('.hero canvas')).toBeVisible({ timeout: 20000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sectors').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Explore sector' }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Startup technologies' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(errors).toEqual([]);
});

test('customer signs in with Secure localhost cookies, reads exact balance and logs out', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('sales@bakhtiariautogroup.com');
  await page.getByLabel('Password', { exact: true }).fill('FounderClient!2026');
  await page.getByRole('button', { name: /Sign in securely/ }).click();
  await expect(page.getByRole('heading', { name: '$31,230.00', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Transactions/ }).click();
  await page.getByRole('combobox').selectOption('2026-06');
  await expect(page.getByRole('cell', { name: 'Opening deposit' })).toBeVisible();
  await page.getByRole('button', { name: /Log out/ }).click();
  await expect(page.getByRole('heading', { name: /Built for what/ })).toBeVisible();
});

test('moderator calculates preview, verifies archive and downloads an issued PDF', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Moderator access/ }).click();
  await page.getByLabel('Email', { exact: true }).fill('tpower@siliconvalleybankandtrust.com');
  await page.getByLabel('Password', { exact: true }).fill('ModeratorGod!2026');
  await page.getByRole('button', { name: /Sign in securely/ }).click();
  await expect(page.getByRole('heading', { name: '$31,230.00', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Statements/ }).click();
  await page.getByLabel('Statement month').fill('2026-09');
  await page.getByRole('button', { name: /Calculate preview/ }).click();
  await expect(page.locator('.stat-grid')).toContainText('$31,230.00');
  await page.getByRole('button', { name: 'Check integrity' }).first().click();
  await expect(page.getByText('Integrity verified', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download branded PDF/ }).first().click();
  expect((await download).suggestedFilename()).toBe('business-checking-2026-09-r1.pdf');
  await page.getByRole('button', { name: /^Investments/ }).click();
  await expect(page.getByRole('heading', { name: 'Restricted investment records' })).toBeVisible();
  await expect(page.locator('.investment-card')).toHaveCount(3);
});

