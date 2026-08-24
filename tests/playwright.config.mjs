/* Playwright config for the browser suite (tests/browser.spec.mjs), invoked
 * through tests/run-browser.sh. The functional suite runs in all three
 * engines; the @visual screenshot tests are chromium-only and compare against
 * baselines in tests/screenshots/, which each app repo owns and regenerates
 * with its update-screenshots workflow (CI-rendered, so local font stacks
 * never enter the baselines).
 * Synced from the trainer-engine repo; do not edit in an app repo. */
import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PORT || 8123);

export default defineConfig({
  testDir: '.',
  testMatch: 'browser.spec.mjs',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  expect: {
    toHaveScreenshot: {
      // Loose enough to absorb antialiasing drift between Chromium builds,
      // tight enough that a real layout or palette change fails.
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  // Baselines are keyed by project only (no platform suffix): they are
  // rendered and compared on CI runners, so the platform never varies.
  snapshotPathTemplate: '{testDir}/screenshots/{projectName}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node serve.mjs ${port}`,
    url: `http://127.0.0.1:${port}/tests/test.html`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
