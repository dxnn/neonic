// Panel 3 (Paint it): row activation, cycles input clamp, preset
// switch repaints the swatch, remove-palette removes a row (after
// confirming).
import { test, expect } from '@playwright/test';

test('clicking a row head opens its drawer', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  await expect(row).not.toHaveClass(/\bopen\b/);
  await row.locator('.swatch').click();
  await expect(row).toHaveClass(/\bopen\b/);
});

test('cycles input clamps to [1, 99]', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  const cycles = row.locator('.pal-row-head input[type=number]').first();

  await cycles.fill('0');
  await cycles.dispatchEvent('change');
  await expect(cycles).toHaveValue('1');

  await cycles.fill('200');
  await cycles.dispatchEvent('change');
  await expect(cycles).toHaveValue('99');

  await cycles.fill('5');
  await cycles.dispatchEvent('change');
  await expect(cycles).toHaveValue('5');
});

test('Switching the drawer preset repaints the swatch', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  await row.locator('.swatch').click();
  await expect(row).toHaveClass(/\bopen\b/);

  // Sample the swatch's centre pixel before switching.
  const swatch = row.locator('.swatch');
  async function centrePixel() {
    return swatch.evaluate((c) => {
      const ctx = c.getContext('2d');
      const x = Math.floor(c.width / 2);
      const y = Math.floor(c.height / 2);
      const d = ctx.getImageData(x, y, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
  }
  const before = await centrePixel();

  await row.locator('.preset-select').selectOption('cyan');
  await row.getByRole('button', { name: 'switch' }).click();

  await expect.poll(async () => {
    const after = await centrePixel();
    return after.some((v, i) => v !== before[i]);
  }, { timeout: 1_000 }).toBe(true);
});

test('Remove palette deletes a non-active row', async ({ page }) => {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.pal-row')).toHaveCount(2);

  // The second row is active after Add; its drawer is open, exposing
  // the remove-palette button at the bottom of the drawer. Removal is
  // immediate now (no confirm popup — it's in the undo stack).
  await page.locator('.pal-row.open').getByRole('button', { name: /remove palette/i }).click();
  await expect(page.locator('.pal-row')).toHaveCount(1);
});

test('Remove palette button is disabled when only one palette exists', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  await row.locator('.swatch').click();
  await expect(row).toHaveClass(/\bopen\b/);
  await expect(row.getByRole('button', { name: /remove palette/i })).toBeDisabled();
});

// ─── Undo / redo over palette ops ─────────────────────────────────────────

test('Undo reverses Add palette', async ({ page }) => {
  await page.goto('index.html');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.pal-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.pal-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.pal-row')).toHaveCount(2);
});

test('Undo reverses preset switch', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  await row.locator('.swatch').click();

  const select = row.locator('.preset-select');
  await expect(select).toHaveValue('rainbow');
  await select.selectOption('cyan');
  await row.getByRole('button', { name: 'switch' }).click();
  // The drawer's dropdown reflects the active preset.
  await expect(select).toHaveValue('cyan');

  await page.getByRole('button', { name: 'Undo' }).click();
  // Drawer rebuilds after applySnapshot; re-fetch the select.
  await expect(row.locator('.preset-select')).toHaveValue('rainbow');
});

test('Undo reverses cycles edit', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  const cycles = row.locator('.pal-row-head input[type=number]').first();
  await expect(cycles).toHaveValue('1');
  await cycles.fill('7');
  await cycles.dispatchEvent('change');
  await expect(cycles).toHaveValue('7');
  await page.getByRole('button', { name: 'Undo' }).click();
  // After applySnapshot the row is rebuilt; re-locate.
  await expect(
    page.locator('.pal-row').first().locator('.pal-row-head input[type=number]').first()
  ).toHaveValue('1');
});
