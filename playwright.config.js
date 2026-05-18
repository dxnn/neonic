// Playwright config — chromium only, hits the always-running static
// server at localhost:8080 (no webServer block: we don't manage that
// process). The base URL is the editor's path under that server, so
// page.goto('/') in specs lands on index.html.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080/new/svg-to-palette-shift/',
    // trace: 'on' here would be heavy. Default 'retain-on-failure'
    // gives us the trace viewer payload only when something breaks.
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--no-sandbox'] } } },
  ],
});
