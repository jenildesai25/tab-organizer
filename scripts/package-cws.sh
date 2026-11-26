#!/usr/bin/env bash
# package-cws.sh — Build production dist/ and zip it for Chrome Web Store upload.
# Ships only what Chrome needs (contents of dist/). Excludes source, tests, docs.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Production build"
npm run build

VERSION="$(node -p "require('./dist/manifest.json').version")"
OUT_DIR="$ROOT/release"
ZIP="$OUT_DIR/tab-organizer-v${VERSION}.zip"

mkdir -p "$OUT_DIR"
rm -f "$ZIP"

echo "==> Zipping dist/ → $ZIP"
(
  cd dist
  zip -r "$ZIP" . \
    -x "*.DS_Store" \
    -x "*.map" \
    -x "Thumbs.db"
)

SIZE="$(du -h "$ZIP" | cut -f1)"
echo "Packaged: $ZIP ($SIZE)"
echo
echo "Upload path: $ZIP"
echo "Host privacy policy + screenshots before you submit. This script does not submit."
