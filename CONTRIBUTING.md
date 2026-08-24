# Contributing

Thanks for taking the time. This repository is the shared engine behind the
six ullbergm exam trainers (epa, faa-drone, fcc-commercial, nc-cdl,
nc-locksmith, nc-pesticide): the spaced-repetition study UI, the FSRS scheduler, the
readiness projection, storage, the service worker, the structural CSS, and
the shared test suites.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ways to help

- **Report a bug.** Use the
  [bug report template](https://github.com/ullbergm/trainer-engine/issues/new?template=bug-report.yml).
  If you saw it in one of the trainer apps, say which one; the engine code is
  identical across all six, so it almost certainly reproduces everywhere.
- **Fix a question.** The question banks are not here. Open the correction in
  the app repository for the trainer you were using.
- **Report a vulnerability.** Do not open a public issue. Follow
  [SECURITY.md](SECURITY.md).
- **Write code.** Bug fixes and small, self-contained features are welcome.
  For anything large, open an issue first so we can agree on the shape before
  you spend the time. Remember that everything here ships verbatim to six
  apps, so a change has to make sense for all of them.

## Getting set up

```
git clone https://github.com/ullbergm/trainer-engine.git
cd trainer-engine
npm install          # dev tooling only; the engine itself has no dependencies
```

There is no app to open here: the engine has no `index.html` and no question
bank of its own. To see a change running, clone one of the app repositories
next to this one, copy the files you changed over its synced copies (or
symlink them while you work), and use that app's `npm run serve`. Undo the
copy before opening a pull request there; app CI rejects edits to synced
files.

## Before you open a pull request

Run everything CI runs:

```
npm run lint
npm test             # FSRS scheduler + readiness projection tests
```

Every line should say `PASS`. The browser end-to-end suite
(`tests/engine-suite.js`) also lives here, but it needs a real app around it,
so it runs in each app's CI on the sync pull request rather than in this
repository.

## Engine files and app files

Every file listed in [`MANIFEST`](MANIFEST) is owned by this repository and
synced verbatim into each app. Each app owns its own `data/` (the question
bank and exam config), `css/app.css` (the colors), `index.html`, icons and
manifest, `tests/test.html`, and eslint config; those belong in the app
repositories, and the pesticide trainer additionally owns its capability
modules. If a change needs both an engine part and an app part, land the
engine part here first; the app part can ride the sync pull request or
follow it.

## House rules for code

- No dependencies and no build step. The engine ships the files in the
  repository exactly as they are: browser JavaScript, plain CSS, plain HTML.
  If a change would add a runtime dependency, open an issue first.
- The engine must work for every app, including the pesticide trainer's
  extra capability modules, without knowing which app it is in. App-specific
  behavior belongs behind the existing configuration and registration hooks,
  not in `if` statements naming an app.
- Follow the style already in the file you are editing. `npm run lint`
  catches the rest.
- Anything user-visible needs to work on a phone. Most people study on one.
- Keep the DOM escaping helpers in place. Content goes through them for a
  reason, and each app's Content Security Policy is the second layer, not
  the first.

## Commits and releases

Write every commit message as a
[Conventional Commit](https://www.conventionalcommits.org/), because
[release-please](https://github.com/googleapis/release-please) reads the
commits on `main` to build the changelog and pick the next version:

- `feat:` for a new capability, which bumps the minor version
- `fix:` for a bug fix, which bumps the patch version
- `chore:`, `docs:`, `test:`, `ci:`, and `refactor:` for everything else,
  which do not trigger a release on their own

Write the subject in the imperative and describe the effect, for example
`fix: clamp the review interval to the exam date`. Add `!` after the type for
a breaking change. The body is where the reasoning goes. Do not start a body
line with a type prefix; release-please reads bodies as well as subjects, so
a stray prefix down there becomes a second changelog entry.

Give a pull request itself a plain prose title with no type prefix. GitHub
copies the title into the merge commit, where a conventional prefix would
list the change twice in the changelog. The `Commit conventions` workflow
checks both halves of that.

Merging to `main` does not reach the apps. Releases happen when the
release-please pull request is merged, which tags the version, publishes the
release notes, and opens a sync pull request in each app repository carrying
exactly the files in `MANIFEST`. Each app's own CI (bank validation, unit
tests, browser suite) runs on that pull request before it can merge, and the
change only reaches a live site through that app's next release.

## Documentation and copy

Plain, direct prose. No emoji, no marketing voice, and no em dashes. Match
the tone of the README.
