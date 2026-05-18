// Zoom compound chip: typing a percentage and pressing Enter applies
// it as a manual view scale. Fit resets to the auto-fit value derived
// from the path bbox.
import { test, expect } from '@playwright/test';

test('typing into the zoom chip applies a manual scale', async ({ page }) => {
  await page.goto('index.html');

  // Draw something small so the bezier panel has content to anchor the
  // auto-fit on (auto-fit is bbox-based; with no path, the percentage
  // sits at 100%).
  const draw = page.locator('#draw');
  const box = await draw.boundingBox();
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(
      box.x + 60 + i * 6,
      box.y + box.height / 2 + Math.sin(i / 3) * 20,
      { steps: 2 }
    );
  }
  await page.mouse.up();
  await page.waitForFunction(
    () => /\d+×\d+/.test(document.getElementById('bake-meta').textContent || '')
  );

  const zoom = page.locator('#zoom-val');
  await zoom.fill('150');
  await zoom.press('Enter');
  // After applying, the next render mirrors the live scale back in. We
  // poll because the apply path goes through scheduleRender (rAF).
  await expect.poll(async () => zoom.inputValue(), { timeout: 1_000 })
    .toMatch(/^150%$/);

  await page.getByRole('button', { name: 'fit' }).click();
  // Auto-fit value depends on the bbox; just assert we're back to
  // something that isn't 150%.
  await expect.poll(async () => zoom.inputValue(), { timeout: 1_000 })
    .not.toBe('150%');
});
