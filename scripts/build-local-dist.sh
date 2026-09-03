#!/usr/bin/env bash
# Build client/dist for the LOCAL scratch stack (the browser suites' target).
# Every VITE_* override the local preview needs, in one place — a dist built
# with only VITE_API_URL breaks portal-visual (no /portal-api proxy on vite
# preview; the pathed overrides below are the local substitutes for the
# vercel.json proxies). BUILD-75: this exact omission red-lit two pushes.
set -euo pipefail
cd "$(dirname "$0")/../client"
VITE_API_URL=http://localhost:5601 \
VITE_ASSET_ORIGIN=http://localhost:5601 \
VITE_PORTAL_API=http://localhost:5601/portal \
VITE_ACCOUNT_API=http://localhost:5601/account \
VITE_NETWORK_API=http://localhost:5601/network \
npm run build
echo "local dist built — serve with: npx vite preview --port 4173 (from client/)"
