// Panel 1 (Sketch it) controls: Clear, Stroke, Thin, Smooth, Undo/Redo.
// Each test draws a synthetic stroke first so the controls have
// something to act on.
import { test, expect } from '@playwright/test';

async function drawWavy(page) {
  const draw = page.locator('#draw');
  const box = await draw.boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) {
    await page.mouse.move(
      box.x + 30 + (i / 30) * (box.width - 60),
      box.y + box.height / 2 + Math.sin(i / 3) * 30,
      { steps: 2 }
    );
  }
  await page.mouse.up();
  // Wait for the debounced bake to populate.
  await expect(page.locator('#bake-meta')).toHaveText(/\d+×\d+.*KB/, { timeout: 2_000 });
}

test('Clear empties the path and clears the bake meta', async ({ page }) => {
  await page.goto('index.html');
  await drawWavy(page);

  await expect(page.locator('#bake-meta')).not.toHaveText('');
  await page.getByRole('button', { name: 'Clear' }).click();
  // Clear sets bake-meta back to empty and shrinks #out to 1×1.
  await expect(page.locator('#bake-meta')).toHaveText('');
  const outDims = await page.locator('#out').evaluate((c) => ({ w: c.width, h: c.height }));
  expect(outDims).toEqual({ w: 1, h: 1 });
});

test('Stroke slider updates the readout (and re-renders)', async ({ page }) => {
  await page.goto('index.html');
  await drawWavy(page);
  // The bake's bbox is anchor-driven, so changing the stroke width
  // doesn't change #bake-meta's `W×H · KB`. Use the slider's own
  // readout span as the live signal; the listener firing updates it
  // synchronously alongside the rebake.
  const stroke = page.getByLabel('Stroke');
  await stroke.fill('48');
  await stroke.dispatchEvent('input');
  await expect(page.locator('#strokeW-val')).toHaveText('48');
});

test('Thin slider updates the readout (and re-renders)', async ({ page }) => {
  await page.goto('index.html');
  await drawWavy(page);
  const thin = page.getByLabel('Thin');
  await thin.fill('0.95');
  await thin.dispatchEvent('input');
  await expect(page.locator('#thinning-val')).toHaveText('0.95');
});

test('Smooth reduces or keeps the anchor count', async ({ page }) => {
  await page.goto('index.html');
  await drawWavy(page);
  // bezMeta is hidden in the new chrome, but its textContent is still
  // set on every render — read it directly for the anchor count.
  async function anchorCount() {
    return page.locator('#bez-meta').evaluate((el) => {
      const m = (el.textContent || '').match(/^(\d+)\s+anchors/);
      return m ? +m[1] : null;
    });
  }
  const before = await anchorCount();
  expect(before).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Smooth' }).click();
  await expect.poll(anchorCount, { timeout: 1_000 }).toBeLessThanOrEqual(before);
});

test('Undo removes the last drawn path; Redo restores it', async ({ page }) => {
  await page.goto('index.html');
  await drawWavy(page);
  // #bez-meta is hidden but its textContent is updated on every render,
  // so we read the anchor count directly. (#bake-meta isn't a reliable
  // signal here — rebake() bails when paths is empty, leaving stale
  // text behind.)
  async function anchorCount() {
    return page.locator('#bez-meta').evaluate((el) => {
      const m = (el.textContent || '').match(/^(\d+)\s+anchors/);
      return m ? +m[1] : 0;
    });
  }
  const drawn = await anchorCount();
  expect(drawn).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(anchorCount).toBe(0);

  await page.getByRole('button', { name: 'Redo' }).click();
  await expect.poll(anchorCount).toBe(drawn);
});
