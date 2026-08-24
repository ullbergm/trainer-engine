#!/usr/bin/env bash
# Runs the Playwright browser suite (tests/browser.spec.mjs): the engine
# suite and a cold boot in chromium, firefox and webkit, plus chromium
# screenshot comparisons when tests/screenshots/ baselines exist.
# The single source of truth for how the browser suite is invoked: used by
# `npm run test:browser` locally and by the GitHub workflows. Extra arguments
# pass through to `playwright test` (e.g. --update-snapshots, --project).
# Synced from the trainer-engine repo; do not edit in an app repo.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d node_modules/@playwright ]; then
  echo "@playwright/test is not installed; run npm ci first" >&2
  exit 1
fi

# A no-op when the browsers are already in ~/.cache/ms-playwright. The system
# library install (--with-deps) needs sudo, so it stays CI-only — and webkit
# needs those libraries, so a local run covers chromium and firefox and CI
# covers all three. Pass --project=webkit yourself if your machine has the
# libraries.
if [ -n "${CI:-}" ]; then
  npx playwright install --with-deps chromium firefox webkit
  npx playwright test --config tests/playwright.config.mjs "$@"
else
  npx playwright install chromium firefox
  npx playwright test --config tests/playwright.config.mjs \
    --project=chromium --project=firefox "$@"
fi
