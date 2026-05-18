// Panel 2 (Tweak it) chrome: the tap-mode segmented control mirrors
// into the hidden #bezierMode select, and the zoom-chip +/- buttons
// nudge the manual view scale.
import { test, expect } from '@playwright/test';

async function drawSmall(page) {
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
}

test('tap-mode segmented control mirrors into bezierMode', async ({ page }) => {
  await page.goto('index.html');

  // Default starts on 'drag'.
  const seg = page.locator('#tool-seg');
  await expect(seg.locator('button.on')).toHaveText('drag');
  await expect(page.locator('#bezierMode')).toHaveValue('drag');

  // Click each mode and verify both the seg's .on state and the hidden
  // select's value follow.
  for (const mode of ['add', 'remove', 'pan', 'drag']) {
    await seg.getByRole('button', { name: mode }).click();
    await expect(seg.locator('button.on')).toHaveText(mode);
    await expect(page.locator('#bezierMode')).toHaveValue(mode);
  }
});

test('pan mode tags the bezier canvas with pan-mode class', async ({ page }) => {
  await page.goto('index.html');
  await page.locator('#tool-seg').getByRole('button', { name: 'pan' }).click();
  await expect(page.locator('#bezier')).toHaveClass(/pan-mode/);
});

test('zoom +/- buttons change the displayed percentage', async ({ page }) => {
  await page.goto('index.html');
  await drawSmall(page);
  const zoom = page.locator('#zoom-val');
  const start = (await zoom.inputValue()).replace('%', '');

  // The chip uses two buttons titled 'Zoom in' / 'Zoom out'. They're
  // inside the chip; getByRole picks them up by title.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => (await zoom.inputValue()).replace('%', ''),
    { timeout: 1_000 }).not.toBe(start);

  const zoomedIn = (await zoom.inputValue()).replace('%', '');
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(async () => (await zoom.inputValue()).replace('%', ''),
    { timeout: 1_000 }).not.toBe(zoomedIn);
});
