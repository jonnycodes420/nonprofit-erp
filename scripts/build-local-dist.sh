#!/usr/bin/env bash
# Build client/dist for the LOCAL scratch stack (the browser suites' target).
# Every VITE_* override the local preview needs, in one place — a dist built
# with only VITE_API_URL breaks portal-visual (no /portal-api proxy on vite
# preview; the pathed overrides below are the local substitutes for the
# vercel.json proxies). BUILD-75: this exact omission red-lit two pushes.
#
# VOL-1 — THE API PORT IS AN OVERRIDE NOW, not a constant. CLAUDE.md requires
# a database and a port block PER WORKTREE, and this script baked :5601 into
# every dist, so a second worktree's browser legs silently talked to the FIRST
# worktree's server and read the FIRST worktree's database. Nothing errors:
# you get a real app, fully logged in, showing another build's data, and the
# walk fails on assertions that look like product defects. `API=…` (the same
# variable scripts/local-preview.js already takes) now names the port, and
# the default is unchanged so every existing caller behaves identically.
#
#   API=http://localhost:5611 bash scripts/build-local-dist.sh
set -euo pipefail
cd "$(dirname "$0")/../client"
API="${API:-http://localhost:5601}"
if ! printf '%s' "$API" | grep -Eq '^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$'; then
  echo "REFUSED: API=$API is not loopback. This builds a LOCAL dist only." >&2
  exit 1
fi
VITE_API_URL="$API" \
VITE_ASSET_ORIGIN="$API" \
VITE_PORTAL_API="$API/portal" \
VITE_ACCOUNT_API="$API/account" \
VITE_NETWORK_API="$API/network" \
npm run build
echo "local dist built against $API — serve with: API=$API PORT=<port> node scripts/local-preview.js"
