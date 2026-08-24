/* The Playwright browser suite, run via tests/run-browser.sh.
 *
 * Functional (all engines): loads tests/test.html, which boots the real app
 * with a planted session and runs tests/engine-suite.js; any FAIL/EXCEPTION
 * entry in its RESULTS:: log fails here. A second test boots index.html cold
 * and fails on any console error or uncaught exception.
 *
 * Visual (@visual, chromium only): screenshots of the app's key states,
 * compared against tests/screenshots/chromium/. The baselines are app-owned
 * and CI-rendered — regenerate them with the app repo's update-screenshots
 * workflow, not from a local run, so one font stack renders every baseline.
 * Until a baseline exists its test skips rather than fails.
 * Synced from the trainer-engine repo; do not edit in an app repo. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Frozen clock for anything date-derived on screen (due counts, projections),
// so screenshots and suite runs do not drift with the calendar.
const FIXED_TIME = new Date('2026-01-15T15:00:00Z');

const here = path.dirname(fileURLToPath(import.meta.url));
const baseline = name => path.join(here, 'screenshots', 'chromium', name);

test('engine suite passes in tests/test.html', async ({ page }) => {
  const exceptions = [];
  page.on('pageerror', err => exceptions.push(String(err)));
  await page.clock.install({ time: FIXED_TIME });
  await page.goto('/tests/test.html');
  const log = page.locator('#testlog');
  await expect(log, 'suite never published RESULTS::').toContainText('RESULTS::', { timeout: 30_000 });
  const results = (await log.innerText()).replace(/^RESULTS::/, '').split('||').filter(Boolean);
  expect(results.length, 'suite ran no checks').toBeGreaterThan(0);
  const failures = results.filter(r => !r.startsWith('PASS'));
  expect(failures, `${failures.length} of ${results.length} checks failed`).toEqual([]);
  expect(exceptions, 'uncaught exception during the suite').toEqual([]);
});

test('index.html boots cold without console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err}`));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  await page.clock.install({ time: FIXED_TIME });
  await page.goto('/index.html');
  await expect(page.locator('#view')).not.toBeEmpty();
  expect(errors).toEqual([]);
});

// Each entry becomes one chromium screenshot test: the view is reached by
// hash route, on a fresh profile, at a fixed clock.
const SHOTS = [
  { name: 'home-desktop-light.png', hash: '#home', viewport: { width: 1280, height: 800 } },
  { name: 'home-desktop-dark.png', hash: '#home', viewport: { width: 1280, height: 800 }, colorScheme: 'dark' },
  { name: 'home-mobile-light.png', hash: '#home', viewport: { width: 390, height: 844 } },
  { name: 'browse-desktop-light.png', hash: '#browse', viewport: { width: 1280, height: 800 } },
];

test.describe('@visual', () => {
  for (const shot of SHOTS) {
    test(`screenshot ${shot.name}`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'visual baselines are chromium-only');
      // 'missing' is the default mode and would write a local baseline as a
      // side effect; baselines must come from the update-screenshots workflow
      // (one CI-rendered font stack), so only an explicit --update-snapshots
      // ('all'/'changed') counts as updating here.
      const mode = test.info().config.updateSnapshots;
      const updating = mode === 'all' || mode === 'changed';
      test.skip(!updating && !fs.existsSync(baseline(shot.name)),
        'no baseline yet; run the update-screenshots workflow');
      await page.setViewportSize(shot.viewport);
      await page.emulateMedia({ colorScheme: shot.colorScheme || 'light' });
      await page.clock.install({ time: FIXED_TIME });
      await page.goto('/index.html' + shot.hash);
      await expect(page.locator('#view')).not.toBeEmpty();
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(shot.name, { fullPage: true });
    });
  }
});
