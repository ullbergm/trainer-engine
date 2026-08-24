#!/usr/bin/env bash
# Copy this trainer-engine working tree's engine files into the app repo you
# are standing in — the same list the real sync workflow ships (MANIFEST) — so
# an engine change can be tried in an app before it is pushed and released.
# Undo with hacks/engine-revert.sh. Never commit the copies in the app repo:
# its engine-guard CI will fail the PR and point back here.
set -euo pipefail
engine="$(cd "$(dirname "$0")/.." && pwd)"
app="$(git rev-parse --show-toplevel)"
if [ "$app" = "$engine" ]; then
  echo "you are in trainer-engine itself; cd into an app repo first" >&2
  exit 1
fi
if [ ! -f "$app/data/exam-config.js" ]; then
  echo "$app does not look like a trainer app repo (no data/exam-config.js)" >&2
  exit 1
fi
grep -v '^#' "$engine/MANIFEST" | while read -r f; do
  [ -n "$f" ] || continue
  mkdir -p "$app/$(dirname "$f")"
  cp "$engine/$f" "$app/$f"
done
git -C "$app" status --short
echo "synced local engine into ${app##*/}; revert with ${engine}/hacks/engine-revert.sh"
