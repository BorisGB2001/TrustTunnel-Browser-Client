#!/bin/bash
# Packs extension/ into dist/trusttunnel-chrome-<version>.zip for the Chrome Web Store.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/extension/manifest.json")"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/trusttunnel-chrome-$VERSION.zip"
rm -f "$OUT"
(cd "$ROOT/extension" && zip -qr -X "$OUT" . -x '.*')
echo "$OUT"
