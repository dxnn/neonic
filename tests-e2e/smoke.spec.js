// Smoke: editor loads, four panel headers render, brand glyph mounts
// its cycling canvas, no console errors.
import { test, expect } from '@playwright/test';

test.describe('editor smoke', () => {
  let consoleErrors;

  test.beforeEach(async ({ page }) => {
    consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    await page.goto('index.html');
  });

  test('loads with the four step headers', async ({ page }) => {
    await expect(page).toHaveTitle(/Neonic/);
    for (const label of ['Sketch it', 'Tweak it', 'Paint it', 'Grab it']) {
      await expect(page.getByRole('heading', { name: label })).toBeVisible();
    }
  });

  test('brand glyph mounts a cycling canvas', async ({ page }) => {
    const glyph = page.locator('.glyph canvas.logo-cycle');
    await expect(glyph).toBeVisible();
    await expect(glyph).toHaveAttribute('data-src', 'neonic.neonic.png');
    // The loader runs on DOMContentLoaded; once it's done, the canvas has
    // a non-zero pixel buffer (collapseCanvasIntrinsic sets it to 1×1
    // before measuring, then the bake replaces it).
    await expect.poll(async () =>
      glyph.evaluate((c) => ({ w: c.width, h: c.height }))
    ).toEqual(expect.objectContaining({ w: expect.any(Number) }));
    const dims = await glyph.evaluate((c) => ({ w: c.width, h: c.height }));
    expect(dims.w).toBeGreaterThan(1);
    expect(dims.h).toBeGreaterThan(1);
  });

  test('no console errors on first paint', async ({ page }) => {
    // Give async work (loader, font load) a moment to settle.
    await page.waitForLoadState('networkidle');
    expect(consoleErrors).toEqual([]);
  });
});
