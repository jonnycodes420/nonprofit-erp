#!/usr/bin/env bash
# BUILD-23 Part 3 — the standard test run.
#
# Runs every committed verification suite that needs only a local scratch server
# + scratch Postgres (tests/README.md recipe), in one go, and fails if any suite
# fails. THIS is the gate a future build must keep green — it includes
# consistency-e2e.test.js, the forward guardrail against the gift/webhook
# duplication class (BUILD-23).
#
# Prereqs (see tests/README.md):
#   1. scratch Postgres 16 up on :5544
#   2. server booted with a KNOWN webhook secret so consistency-e2e can drive the
#      online-gift path, AND with RESEND_BASE_URL pointing at a local sink port so
#      workflows-e2e can capture (never send) the recipe emails:
#        DATABASE_URL=…:5544/steward_loadtest JWT_SECRET=local-test-secret \
#        PORT=5601 DISABLE_RATE_LIMIT=1 RESEND_API_KEY=re_dummy_local \
#        RESEND_BASE_URL=http://localhost:5602 DEMO_SMTP_FROM=noreply@stewardapp.dev \
#        STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest \
#        node server.js
#      (RESEND_BASE_URL just redirects mail to a local port; workflows-e2e starts
#      its own capture server there for its run, and other suites' sends simply
#      fail-and-log against the unbound port — no real email ever leaves.)
#
# Usage:  bash tests/run-all.sh
#
# NOT included here (need extra setup — run individually, see tests/README.md):
#   donors-pagination, reports  → need `node scripts/seed-loadtest.js` first
#   email-footer                → needs a mock Resend on :5602 (RESEND_BASE_URL)
#   export-zip                  → needs the `unzip` binary + the loadtest org
#   cover-fees                  → needs real Stripe test creds (STRIPE_TEST_KEY)

set -u
cd "$(dirname "$0")/.."

# Self-contained suites (server + scratch DB only). Alphabetical.
CORE=(
  attribution-completeness
  billing billing-config-error brand-glyph branding clickability consistency-e2e designations digests
  donor-merge email-links email-polish finance-entity-routing finance-funds finance-gift-stamp finance-overview greeting
  finance-reintegration fundraising gift-attribution goals home home-layout households impact
  import-assign import-both import-combined import-shape import-stage
  locked-features
  brand-allowlist moves no-emoji notifications onboarding-brand palette pipeline pipeline-gating portfolios portfolio-pipeline-consistency reports-cadence setup-checklist
  report-truth
  smart-moves tasks tenant-isolation upgrade-checkout workflows workflows-e2e
  finance-reports-consistency name-normalize reserved-recovered concurrency
)

pass=0; fail=0; failed=()
for name in "${CORE[@]}"; do
  file="tests/${name}.test.js"
  [ -f "$file" ] || { echo "  SKIP  $name (missing)"; continue; }
  last=$(node "$file" 2>&1 | tail -1)
  if [[ "$last" == *"0 failed"* ]]; then
    printf "  \033[32mPASS\033[0m  %-24s %s\n" "$name" "$last"
    pass=$((pass+1))
  else
    printf "  \033[31mFAIL\033[0m  %-24s %s\n" "$name" "$last"
    fail=$((fail+1)); failed+=("$name")
  fi
done

echo ""
echo "Suites: $pass passed, $fail failed"
if [ "$fail" -ne 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
echo "All consistency + core suites green."
