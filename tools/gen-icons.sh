#!/usr/bin/env bash
# Renders the app icons from icons/icon.svg. Needs rsvg-convert (librsvg).
#
# The maskable variant is the same artwork with the corner radius stripped:
# launcher masks supply the shape, so its background must bleed to the edges,
# while the regular icons keep their rounded corners.
set -euo pipefail
cd "$(dirname "$0")/.."

rsvg-convert -w 192 -h 192 icons/icon.svg -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icons/icon.svg -o icons/icon-512.png
sed 's/rx="96"/rx="0"/' icons/icon.svg | rsvg-convert -w 512 -h 512 -o icons/icon-maskable-512.png
echo "icons rendered from icons/icon.svg"
