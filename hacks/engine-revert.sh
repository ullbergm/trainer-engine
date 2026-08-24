#!/usr/bin/env bash
# Undo hacks/engine-sync.sh: restore every MANIFEST-listed file in the app
# repo you are standing in to its committed (released) version.
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
  # A file the engine ships but this app has not received yet has no committed
  # version to restore; checkout would fail on it, so drop the copy instead.
  if git -C "$app" cat-file -e "HEAD:$f" 2>/dev/null; then
    git -C "$app" checkout -- "$f"
  else
    rm -f "$app/$f"
  fi
done
git -C "$app" status --short
echo "restored ${app##*/} to its committed engine files"
