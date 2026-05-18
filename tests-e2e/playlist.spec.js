// Playlist behaviour:
//  - The hamburger grip drags one row onto another and reorders the
//    underlying data. This is the regression we just shipped a fix for
//    (the chrome rewrite silently broke drag-reorder because dragstart
//    now reports the draggable element as e.target).
//  - The per-row speed input clamps negative input back to 0 — we
//    backed out direct negative-speed support pending a watcher rework.
import { test, expect } from '@playwright/test';

// fill() fires `input` but not `change`. The editor's speed handler
// listens for `change`, so we follow each fill with an explicit
// dispatchEvent. Otherwise entry.speed never updates and the assertion
// after the reorder doesn't reflect the swap.
async function setSpeed(input, value) {
  await input.fill(value);
  await input.dispatchEvent('change');
}

// Playwright's locator.dragTo() sometimes fails to fire HTML5 drag
// events without intermediate mouse moves. Doing the sequence by hand
// with a couple of waypoints is more reliable for native drag-and-drop.
async function dragGrip(page, fromLocator, toLocator) {
  const a = await fromLocator.boundingBox();
  const b = await toLocator.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

test('hamburger grip reorders playlist rows', async ({ page }) => {
  await page.goto('index.html');

  // Start with one palette; add a second via the panel-header Add button.
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  const rows = page.locator('.pal-row');
  await expect(rows).toHaveCount(2);

  // Give each row a distinct speed so we can verify the reorder swapped
  // the *data*, not just the DOM nodes.
  const speedFor = (n) => rows.nth(n).locator('.pal-row-head input[type=number]').nth(1);
  await setSpeed(speedFor(0), '11');
  await setSpeed(speedFor(1), '22');

  // Drag row 0's grip onto row 1's swatch (the swatch is unambiguously
  // inside the head, away from any open drawer).
  const grip0   = rows.nth(0).locator('[data-testid="palette-grip"]');
  const swatch1 = rows.nth(1).locator('.swatch');
  await dragGrip(page, grip0, swatch1);

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
