#!/usr/bin/env bash
# Stages the deployable site into dist/: the one recipe for what ships, used
# by the release workflow at deploy time and by the CI lighthouse job so the
# audited page is byte-for-byte what a release would publish. Never stage the
# repo wholesale: tests/test.html clears localStorage on load and would wipe
# the study progress of anyone who opened it on the live origin.
# tests/validate-bank.js cross-checks sw.js's precache list against the copy
# list below, so a new top-level asset must be added here to pass CI.
# Usage: tools/stage-site.sh [version]   (version defaults to 0.0.0-ci)
# Synced from the trainer-engine repo; do not edit in an app repo.
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:-0.0.0-ci}"
version="${version#v}"

rm -rf dist
mkdir dist
cp -r index.html css js data icons manifest.webmanifest sw.js CHANGELOG.md dist/
# A fork without a custom domain has no CNAME; stage it only when present.
if [ -f CNAME ]; then cp CNAME dist/; fi
# version.txt feeds the footer version in the app.
echo "$version" > dist/version.txt
# Stamp the release into the service worker cache name, so each release
# installs as a new worker and the app can offer a reload.
sed -i "s/__VERSION__/$version/" dist/sw.js
grep -q "trainer-' + VERSION" dist/sw.js
! grep -q "__VERSION__" dist/sw.js

echo "staged dist/ as version $version"
