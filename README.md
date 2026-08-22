# trainer-engine

The shared engine behind the ullbergm exam-trainer PWAs:

- [faa-drone-trainer](https://github.com/ullbergm/faa-drone-trainer) — FAA Part 107 remote pilot
- [fcc-commercial-trainer](https://github.com/ullbergm/fcc-commercial-trainer) — FCC commercial radio operator
- [nc-cdl-trainer](https://github.com/ullbergm/nc-cdl-trainer) — NC commercial driver's license
- [nc-pesticide-trainer](https://github.com/ullbergm/nc-pesticide-trainer) — NC pesticide applicator

Each app is a no-build static PWA. The engine is everything exam-agnostic:
the study/exam/stats UI (`js/app.js`), the FSRS scheduler (`js/fsrs.js`),
readiness projection (`js/readiness.js`), persistence (`js/storage.js`), the
service worker (`sw.js`), the structural stylesheet (`css/engine.css`), and
the shared test suites (`tests/`). The files in `MANIFEST` are copied
verbatim into every app repo by the sync workflow, which opens a PR per app
so each app's own CI gates the update. The manifest also syncs itself and an
`engine-guard` workflow, so a pull request in an app repo that edits a synced
file fails CI with a pointer back here (the sync PRs, on the `engine-sync`
branch, are exempt).

## What an app owns

An app repo carries only what names its exam:

- `data/` — the question bank, page maps, `exam-config.js`, and
  `app-assets.js` (the extra files its service worker precaches)
- `css/app.css` — the color tokens (and styles for any app-module markup)
- `index.html`, `manifest.webmanifest`, `icons/`, `CNAME`, PDFs
- `tests/test.html` — the thin browser-test shell (nav + script list), plus
  an optional `tests/app-suite.js` with app-specific browser tests
- optional capability modules (see below)

## Engine extension points

- **`EXAM_CONFIG`** (`data/exam-config.js`) — everything the engine reads:
  storage keys, pass mark, `manuals`, `exams`, `tests`, `testGroups`, prose.
  Notable optional fields: `flatSections` (section numbers are topics shared
  across manuals rather than per-manual chapters), `sectionWord` (how a
  section reads in prose, default `ch.`), `requireExplanations: false`,
  `verbatimPool` + `allowDuplicateChoices` (banks reproduced from published
  pools), `coverageIntroHTML` + `showCoverage`, `licenses` (About reference
  table, with `title`).
- **Capability modules** — a script loaded before `js/app.js` may attach
  `self.Problems` (calculation-drill generator) and `self.Calculator`
  (on-screen calculator); without them every drill code path is a no-op.
- **`self.APP_VIEWS`** — `{ name: render }` registers extra routed views; a
  matching nav tab routes like a built-in one, and tabs with no route are
  removed at boot. `render` receives `{ view, $, esc, go, cfg }`. Buttons in
  module markup take the `btn` class to pick up engine button styling.

## Development

```
npm ci
npm run lint
npm test
```

Bank validation (`tests/validate-bank.js`) and the browser suite
(`tests/engine-suite.js` inside each app's `tests/test.html`) need an app's
data, so they run in the app repos — locally via that repo's `npm test` /
`npm run test:browser`, and in CI on every sync PR.
