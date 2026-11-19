#!/bin/bash
# Packs extension/ into dist/trusttunnel-chrome-<version>.zip for the Chrome Web Store.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p 'require(process.argv[1]).version' "$ROOT/extension/manifest.json")"
# Chrome Web Store rejects a description longer than 132 characters in any locale.
node -e '
  const fs = require("fs"), dir = process.argv[1] + "/extension/_locales";
  for (const l of fs.readdirSync(dir)) {
    const d = JSON.parse(fs.readFileSync(`${dir}/${l}/messages.json`)).extDescription.message;
    if (d.length > 132) { console.error(`extDescription (${l}) is ${d.length} > 132 chars`); process.exit(1); }
  }' "$ROOT"
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/trusttunnel-chrome-$VERSION.zip"
rm -f "$OUT"
(cd "$ROOT/extension" && zip -qr -X "$OUT" . -x '.*')
echo "$OUT"
