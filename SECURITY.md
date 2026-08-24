# Security Policy

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue:

- Preferred: [GitHub private vulnerability reporting](https://github.com/ullbergm/trainer-engine/security/advisories/new)
- Or email: magnus@ullberg.us

Include what you found, where (file and line if you have it), and steps to
reproduce. You can expect an acknowledgment within a few days. Please give a
reasonable window to ship a fix before disclosing publicly; fixes reach users
through each app's normal release process.

## Supported versions

Only the latest release is supported. This repository ships no site of its
own: everything in [`MANIFEST`](MANIFEST) is synced into the five exam
trainer apps (epa, faa-drone, fcc-commercial, nc-cdl, nc-pesticide) when a
release is cut, and deploys to their live sites through their release
pipelines.
There are no maintained older branches.

## Scope

This is the shared engine for five static, dependency-free web apps. There is
no server and no account system; all user progress lives in the browser's own
localStorage and the optional export file the user saves themselves.

Because these files fan out to every trainer, a flaw here affects all five
live sites at once. Reports that are in scope include:

- Cross-site scripting through rendered content. The engine builds its DOM
  with `innerHTML` behind an escaping helper; an escaping gap is a real bug.
  Each app ships a Content Security Policy as a second layer, so a working
  report would typically show a CSP bypass as well.
- Service worker cache poisoning or update-flow abuse (`sw.js`).
- Flaws in the import path (`Store.importJSON` in `js/storage.js`) that let a
  crafted backup file execute code or corrupt more than the importing user's
  own data.
- Supply chain issues in the GitHub Actions pipelines
  (`.github/workflows/`), especially the sync workflow that pushes engine
  files into the app repositories. Actions are pinned to commit SHAs; a
  report that a pinned SHA is compromised or that the sync pipeline can be
  made to deliver untrusted content to the apps is in scope.

Out of scope:

- Anything requiring physical access to the victim's unlocked device or
  browser profile. localStorage is readable by the device's user by design.
- Content accuracy of the study questions. The question banks live in the app
  repositories; report content problems there.
- Denial of service against GitHub Pages, and vulnerabilities in GitHub
  itself (report those to GitHub).
- The `eslint` dev dependency, unless it affects what ships to the apps.

## No secrets here

The repository contains no credentials, tokens, or user data. The sync
workflow uses a `SYNC_TOKEN` secret held in GitHub Actions, never committed.
If you believe you found a secret in the history, report it privately anyway
so it can be confirmed dead and rotated.
