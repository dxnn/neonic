// Draw flow: a synthetic stroke on the draw canvas should produce a
// non-empty bake (#bake-meta gets `W×H · …KB`) and the preview canvas
// must actually cycle (sampled pixel changes between frames).
import { test, expect } from '@playwright/test';

test('stroke → bake → cycling preview', async ({ page }) => {
  await page.goto('index.html');

  // Draw a wavy line on #draw using real pointer events so the editor's
  // pointerdown/move/up handlers fire the same code as a user would.
  const draw = page.locator('#draw');
  const box = await draw.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(box.x + 30, cy);
  await page.mouse.down();
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    const x = box.x + 30 + (i / steps) * (box.width - 60);
    const y = cy + Math.sin(i / 4) * 40;
    await page.mouse.move(x, y, { steps: 2 });
  }
  await page.mouse.up();

  // Bake meta chip should populate after the debounce.
  const bakeMeta = page.locator('#bake-meta');
  await expect(bakeMeta).toHaveText(/\d+×\d+.*KB/, { timeout: 2_000 });

  // Sample a stroke pixel from #out, wait a beat, sample again. With the
  // engine running, the cycling palette should change the colour at
  // that coordinate.
  const out = page.locator('#out');
  async function sampleStrokePixel() {
    return out.evaluate((c) => {
      const ctx = c.getContext('2d');
      for (let dy = 0; dy < c.height; dy += 4) {
        for (let dx = 0; dx < c.width; dx += 4) {
          const px = ctx.getImageData(dx, dy, 1, 1).data;
          if (px[3] > 0) return { x: dx, y: dy, r: px[0], g: px[1], b: px[2] };
        }
      }
      return null;
    });
  }
  const first = await sampleStrokePixel();
  expect(first).not.toBeNull();

  // page.evaluate rather than locator.evaluate — the latter passes the
  // element as the first callback arg, and we don't need a binding here
  // since we look the canvas up by id from inside.
  await expect.poll(async () => {
    const px = await page.evaluate(({ x, y }) => {
      const ctx = document.getElementById('out').getContext('2d');
      const d = ctx.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    }, { x: first.x, y: first.y });
    return px.r !== first.r || px.g !== first.g || px.b !== first.b;
  }, { timeout: 2_000 }).toBe(true);
});
