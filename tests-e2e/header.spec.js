// Header chrome: wordmark, tagline, mid-text, and the 'How it works'
// link pointing at the process essay.
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('index.html');
});

test('wordmark and tagline are visible', async ({ page }) => {
  await expect(page.locator('.wordmark')).toHaveText('neonic');
  await expect(page.locator('.tag')).toHaveText(/hand drawn palette cycling pngs/i);
});

test('mid-header tagline reads "animate your imagination"', async ({ page }) => {
  await expect(page.locator('.hdr-mid')).toContainText('animate your imagination');
});

test('"How it works" link points at the process essay', async ({ page }) => {
  const link = page.getByRole('link', { name: /how it works/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://inwordsandpictures.com/neonic');
});
