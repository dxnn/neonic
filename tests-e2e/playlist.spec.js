// Playlist behaviour:
//  - The hamburger grip drags one row onto another and reorders the
//    underlying data. This is the regression we just shipped a fix for
//    (the chrome rewrite silently broke drag-reorder because dragstart
//    now reports the draggable element as e.target).
//  - The per-row speed input clamps negative input back to 0 — we
//    backed out direct negative-speed support pending a watcher rework.
import { test, expect } from '@playwright/test';

async function speedInputs(page) {
  return page.locator('.pal-row .pal-row-head input[type=number]').nth(1);
}

test('hamburger grip reorders playlist rows', async ({ page }) => {
  await page.goto('index.html');

  // Start with one palette; add a second via the panel-header Add button.
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // Give each row a distinct speed so we can verify the reorder swapped
  // the *data*, not just the DOM.
  const rows = page.locator('.pal-row');
  const speedFor = (n) => rows.nth(n).locator('.pal-row-head input[type=number]').nth(1);
  await speedFor(0).fill('11');
  await speedFor(0).blur();
  await speedFor(1).fill('22');
  await speedFor(1).blur();

  // Drag row 0's grip onto row 1's swatch (the swatch is unambiguously
  // inside the head, away from any open drawer).
  const grip0  = rows.nth(0).locator('[data-testid="palette-grip"]');
  const swatch1 = rows.nth(1).locator('.swatch');
  await grip0.dragTo(swatch1);

  await expect(speedFor(0)).toHaveValue('22');
  await expect(speedFor(1)).toHaveValue('11');
});

test('speed input clamps negative values to 0', async ({ page }) => {
  await page.goto('index.html');
  const row = page.locator('.pal-row').first();
  const speed = row.locator('.pal-row-head input[type=number]').nth(1);
  await expect(speed).toHaveAttribute('min', '0');
  await speed.fill('-50');
  await speed.blur();
  await expect(speed).toHaveValue('0');
});
