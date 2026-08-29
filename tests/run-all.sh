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
#        PORT=5601 DISABLE_RATE_LIMIT=1 SESSION_CACHE_TTL_MS=0 RESEND_API_KEY=re_dummy_local \
#        RESEND_BASE_URL=http://localhost:5602 DEMO_SMTP_FROM=noreply@stewardapp.dev \
#        STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest \
#        STRIPE_API_BASE=http://localhost:5603 \
#        DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1 \
#        MIGC_CONTACT_EMAIL=migc-contact@example.org MIGC_EMAIL_FROM=noreply@stewardapp.dev \
#        DISABLE_BACKGROUND_TICKS=1 \
#        node server.js
#      (DISABLE_BACKGROUND_TICKS=1 is THE flake fix: it turns off every periodic
#      background job (digest/dunning/sweep/sequence timers) so no tick fires
#      mid-suite — the old "fresh boot + wait 90s before running" ritual is
#      RETIRED; the battery can start the moment /health is ok. Every sweep
#      stays drivable via its ops route, so suites lose nothing.)
#      (The MIGC_* pair lets the migc suite capture the contact-form
#      notification through the same :5602 sink; without them the route still
#      stores rows and the suite's sink assertions fail.)
#      (STRIPE_API_BASE points the donation Stripe client at the local mock the
#      portal suite starts on :5603 — BUILD-45's Stripe seam, same pattern as
#      RESEND_BASE_URL. Other suites never call the Stripe API outbound, so an
#      unbound :5603 is equivalent to the dummy key's auth failure.)
#      (SESSION_CACHE_TTL_MS=0 disables the auth session cache so the suites —
#       which reuse fixed user ids and delete/recreate rapidly — see fresh state
#       every request; BUILD-38 Part 1. Prod leaves it unset → the 30s cache.)
#      (RESEND_BASE_URL just redirects mail to a local port; workflows-e2e starts
#      its own capture server there for its run, and other suites' sends simply
#      fail-and-log against the unbound port — no real email ever leaves.)
#
#      (PORTS: the mail sink and Stripe mock default to :5602/:5603, but every
#      suite now reads them from tests/helpers.js — `SINK_PORT` /
#      `STRIPE_MOCK_PORT`. If another product's dev stack is squatting those on
#      this machine, move BOTH together: export SINK_PORT/STRIPE_MOCK_PORT for
#      the suite run AND boot the server with matching RESEND_BASE_URL /
#      STRIPE_API_BASE, or the suites will capture nothing. Unset = the
#      historical values, so CI and the recipe above are unchanged.)
#
# Usage:  bash tests/run-all.sh                      # full battery
#         SUITES="tasks greeting" bash tests/run-all.sh   # only those suites
#         (unknown suite names are a hard error; tests/affected.sh computes a
#          selection from a git range for the pre-push hook)
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
  import-assign import-both import-combined import-shape import-stage invitation landing-reveal
  locked-features migc
  brand-allowlist moves no-emoji notifications officer-chip onboarding-brand palette pipeline pipeline-gating portfolios portfolio-pipeline-consistency reports-cadence setup-checklist solicitations-winrate
  report-truth
  session-cache session-privilege smart-moves state-diff state-diff2 tasks task-due tenant-isolation trial-end upgrade-checkout workflows workflows-e2e
  empty-states presentation-wiring notify-delivery concurrency2 permissions-matrix
  portal-visual
  gift-idempotency portal
  donor-accounts donor-linking org-blindness network-gate donor-dashboard network-directory theme-depth donor-front-door theme-assets
  campaign-impact portal-page portal-designation asset-retention recurring-surface giving-flow-brand portal-crop giving-summary
  ledger-provisioning mail-suppression first-login-matrix import-columns
  stripe-disputes external-fixture-provenance reconciliation webhook-manifest webhook-ordering
  build65 guards
  portal-contrast
  finance-reports-consistency name-normalize reserved-recovered concurrency
  demo-content
  script-guards
)

# SUITES="name1 name2" runs only those suites (each must be in CORE above —
# an unknown name is a hard error so a typo can't silently skip verification).
if [ -n "${SUITES:-}" ]; then
  RUN=()
  for want in $SUITES; do
    found=0
    for name in "${CORE[@]}"; do
      if [ "$name" = "$want" ]; then found=1; break; fi
    done
    if [ "$found" -ne 1 ]; then
      echo "ERROR: unknown suite '$want' (not in run-all.sh CORE)." >&2
      echo "Valid names: ${CORE[*]}" >&2
      exit 2
    fi
    RUN+=("$want")
  done
  echo "[run-all] SUITES selection: running ${#RUN[@]} of ${#CORE[@]} suites: ${RUN[*]}"
else
  RUN=("${CORE[@]}")
fi

# Each suite's FULL output is kept in $SUITE_LOG_DIR (default /tmp/steward-suite-logs),
# and a failing suite's entire output is dumped inline under its FAIL line — so a
# red run (local or CI) shows the failing assertion, not just the suite name.
# CI also uploads the whole log dir as an artifact on failure (ci.yml).
LOGDIR="${SUITE_LOG_DIR:-/tmp/steward-suite-logs}"
mkdir -p "$LOGDIR"
rm -f "$LOGDIR"/*.log 2>/dev/null || true

pass=0; fail=0; failed=()
total_start=$(date +%s)
for name in "${RUN[@]}"; do
  file="tests/${name}.test.js"
  [ -f "$file" ] || { echo "  SKIP  $name (missing)"; continue; }
  log="$LOGDIR/${name}.log"
  t0=$(date +%s)
  node "$file" >"$log" 2>&1
  t1=$(date +%s)
  secs=$((t1 - t0))
  last=$(tail -1 "$log")
  if [[ "$last" == *"0 failed"* ]]; then
    printf "  \033[32mPASS\033[0m  %-24s %4ss  %s\n" "$name" "$secs" "$last"
    pass=$((pass+1))
  else
    printf "  \033[31mFAIL\033[0m  %-24s %4ss  %s\n" "$name" "$secs" "$last"
    echo "  ──── $name: full output ($log) ────"
    cat "$log"
    echo "  ──── end $name output ────"
    fail=$((fail+1)); failed+=("$name")
  fi
done
total_end=$(date +%s)

echo ""
echo "Suites: $pass passed, $fail failed  (total $((total_end - total_start))s)"
if [ "$fail" -ne 0 ]; then
  echo "Failed: ${failed[*]}"
  exit 1
fi
echo "All consistency + core suites green."
