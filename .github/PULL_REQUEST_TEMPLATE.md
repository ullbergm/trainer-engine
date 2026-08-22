## What this changes

<!-- What the change does and why, for whoever reviews it. The commit messages
     are what lands on main, so this can stay short if they already say it.
     Link the issue it closes, like "Closes #12". -->

## How it was tested

<!-- Which of the checks below you ran, plus anything you tried by hand. The
     browser suite ships from this repo but runs in each app's CI on the sync
     PR, so note anything you exercised in a local app checkout. -->

- [ ] `npm run lint`
- [ ] `npm test`

## Checklist

- [ ] Every commit is a [Conventional Commit](https://www.conventionalcommits.org/)
      (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`, `refactor:`). They
      land on `main` unchanged, and every `feat:` and `fix:` becomes a changelog
      line
- [ ] The title above is plain prose with no type prefix. GitHub copies it into
      the merge commit, where a prefix would duplicate the changelog entry
- [ ] The branch is cleaned up: no fixup or work-in-progress commits, one commit
      per idea
- [ ] No new runtime dependencies and no build step
- [ ] The change works for every app, not just the one it was written against.
      Everything in `MANIFEST` ships verbatim to all four trainers
- [ ] User-visible changes work on a phone
