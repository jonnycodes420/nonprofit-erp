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
#        PORT=5601 TEST_MODE=1 SESSION_CACHE_TTL_MS=0 RESEND_API_KEY=re_dummy_local \
#        RESEND_BASE_URL=http://localhost:5602 DEMO_SMTP_FROM=noreply@stewardapp.dev \
#        STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest \
#        INTUIT_API_BASE=http://localhost:5632 XERO_API_BASE=http://localhost:5633 \
#        PAYPAL_WEBHOOK_ID=WH-INT1-LOCALTEST \
#        PAYPAL_WEBHOOK_TEST_CERT="$(node -e 'process.stdout.write(require(\"./tests/fixtures/paypal-webhook-test-key\").PUBLIC_PEM)')" \
#        RESEND_WEBHOOK_SECRET=whsec_YnVpbGQ5NC1sb2NhbC13ZWJob29rLXNlY3JldCE= \
#        STRIPE_API_BASE=http://localhost:5603 \
#        DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1 \
#        MIGC_CONTACT_EMAIL=migc-contact@example.org MIGC_EMAIL_FROM=noreply@stewardapp.dev \
#        DISABLE_BACKGROUND_TICKS=1 CORS_ORIGIN=http://localhost:4173 \
#        STEWARD_CREDENTIAL_KEY=local-scratch-credential-key-0123456789 \
#        FOUNDER_EMAIL=jonathan@stewardapp.dev \
#        STRIPE_BILLING_SECRET_KEY=sk_test_dummy \
#        STRIPE_BILLING_API_BASE=http://localhost:5604 \
#        STRIPE_PRICE_FOUNDING=price_test_founding \
#        STRIPE_PRICE_CORE=price_test_core STRIPE_PRICE_TEAM=price_test_team \
#        INBOUND_EMAIL_ENABLED=1 INBOUND_EMAIL_DOMAIN=log.stewardapp.dev \
#        INBOUND_EMAIL_SECRET=local-inbound-secret \
#        RESEND_RECEIVING_BASE_URL=http://localhost:5612 \
#        GOOGLE_CALENDAR_API_BASE=http://localhost:5618 \
#        node server.js
#      (FIX-11 Part 5: the three INBOUND_EMAIL_* values turn the BCC webhook on;
#      without them fix11-inbound-resend SKIPS, and a suite that skips is
#      coverage that is not there. RESEND_RECEIVING_BASE_URL is a SECOND Resend
#      seam, separate from RESEND_BASE_URL: sending goes to the mail sink and
#      the receiving API is a different API, which that suite stands up itself.)
#      (CORS_ORIGIN=http://localhost:4173 is REQUIRED for every browser leg.
#      The SPA on :4173 calls the API on :5601 cross-origin, and :4173 is not
#      in DEFAULT_CORS_ORIGINS — so without this the browser suites do not
#      fail on their assertions, they fail with "Failed to connect / Failed to
#      fetch" or "nav button not found", which reads exactly like a broken app
#      and is really a missing env var. It cost a clean battery run 11 red
#      suites on 2026-09-23. The suites that need it: empty-states,
#      presentation-wiring, portal-visual, mapper-one-dropdown,
#      thread-step-inline, build88a-profile, build88c-composer,
#      build89s-surfaces, build92-close-screen, build92-sources-page,
#      build92-home-proportions.)
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
#      (BUILD-90: STRIPE_BILLING_API_BASE is the same seam for the PLATFORM
#      billing client, on :5604, which close-link and trial-billing bind. The
#      two Stripe clients are deliberately independent (stripeKeys.js), so they
#      get independent mocks. The three STRIPE_PRICE_* values are ids the mock
#      answers for — a close link refuses to mint without a configured price,
#      which is the correct production behaviour and would otherwise read as a
#      test failure. FOUNDER_EMAIL is the From on the close-link welcome and
#      the seven-day reminder.)
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
#   export-zip                  → needs the `unzip` binary + the loadtest org
#   cover-fees                  → needs real Stripe test creds (STRIPE_TEST_KEY)

set -u
cd "$(dirname "$0")/.."

# The suites are child processes: they inherit ONLY the shell env, not the
# server's. CI exports these two at job level (ci.yml), so a suite that opens
# its own pool in-process — helpers' `q`, or a module like assetStore that a
# suite requires directly — works there and fails locally with either
# "The server does not support SSL connections" (SSL on against the scratch
# server, which has none) or `database "<your username>" does not exist` (no
# connection string at all). Both are the ENVIRONMENT, not the code, and a
# battery that is red for that reason tells you nothing about the build.
# Defaulting them here makes a local run and a CI run the same run.
export DB_SSL="${DB_SSL:-disable}"
export DATABASE_URL="${DATABASE_URL:-postgresql://steward@localhost:5544/steward_loadtest}"

# Self-contained suites (server + scratch DB only). Alphabetical.
CORE=(
  tenant-isolation
  tenant-matrix
  fix11-audit-trail
  fix11-job-audit
  org-blindness
  session-privilege
  auth-revocation
  permissions-matrix
  vol1-coordinator-scope
  lf1-no-donor-data-leaves
  members2-isolation
  events2-checkout
  parity2-auction
  fix20-auction-double-checkout
  fix11-seating
  build103-soft-credit
  agents1-persona-scope
  int1-paypal-webhook
  intpos-sale-is-not-a-gift
  int2-send-once
  parity2-qbo-sync
  fix20-qbo-realm-switch
  oauth-state
  int3-optout
  int4-mailbox
  intb1-calendar-store
  fix14-meeting-counts
  engage1-score-breakdown
  survey1-anonymous
  comms2-statement-total
  sec1-two-factor
  trust2-erase
  clean1-merge
  clean1-duplicates
  prospect1-room-to-give
  prospect1-who-sees
  help1-ask
  why1-appeal-variance
  parity1-donor-tags
  parity1-groups-journeys
  parity3-volunteers
  why1-sentence-check
  fix12-ai-switch
  fix12-recipe-drafts
  fix11-inbound-resend
  int5-api-keys
  script-guards
  fix15-two-worktrees
  build96-ai-gate
  incident-mail-gate
  mail-block
  mail-suppression
  email-footer
  consistency-e2e
  build88a-one-gift
  gift-idempotency
  fix10-gift-delete-tasks
  finance-gift-stamp
  money-cents
  pledge-math
  reconciliation
  fix11-deposits
  fix2-a-footing
  reports3-board-pack
  gtm1a-internal-price
  gtm1b-band-notice
  thread2a-no-send
  fix6-approval
  import-reconciliation
  trans1-reimport
  webhook-manifest
  webhook-ordering
  stripe-disputes
  recurring-recovery
  give2-fee-footing
  campaign2-goal-bar
  trial-end
  upgrade-checkout
  close-link
  import-messy
  fix11-gift-file-import
  import-workbook-v3
  import-columns
  palette
  no-emoji
  landing2-marketing
  clickability
  test-clock-seam
  hotfix1-profile
  smoke-walk
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
pass=0; fail=0; failed=()
total_start=$(date +%s)

# ── FIX-15 · WORKTREE IDENTITY: TWO TABS, TWO BATTERIES, NO COLLISION ──────
# Every shard used to be `steward_shard_<n>` on ports 5700+, in EVERY worktree,
# so a second session's battery dropped the first one's databases mid-run and
# fought it for the ports (FIX-14 had to wait on GIVE-2's). Now the worktree
# names its own: the tag is the worktree folder's name, the databases are
# `steward_<tag>_shard_<n>`, the suite logs are /tmp/steward-suite-logs-<tag>,
# and the port block is claimed (see below) instead of assumed. Each shard
# only ever drops the database it created, so cleanup touches only this
# worktree's names. Explicit SHARD_DB_PREFIX / SHARD_PORT_BASE /
# SUITE_LOG_DIR still win (CI's matrix sets nothing and gets the same shape).
WT_TAG="${STEWARD_WT_TAG:-$(basename "$(pwd)" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '_' | sed 's/^steward_//; s/_*$//' | cut -c1-30)}"
WT_TAG="${WT_TAG:-wt}"
export STEWARD_WT_TAG="$WT_TAG"
export SHARD_DB_PREFIX="${SHARD_DB_PREFIX:-steward_${WT_TAG}_shard_}"
LOGDIR="${SUITE_LOG_DIR:-/tmp/steward-suite-logs-${WT_TAG}}"
mkdir -p "$LOGDIR"
rm -f "$LOGDIR"/*.log 2>/dev/null || true

# ── CHORE-2 · SHARDING ─────────────────────────────────────────────────────
# run-all.sh is still the one entry point. By default it now splits the SAME
# list across SHARDS parallel workers (tests/shard.sh), each with its own
# database, server and port block, and then aggregates one summary.
#
#   SHARDS=1            the old serial run, unchanged, against $BASE
#   SHARDS=6            the default locally
#   SHARDS=<n> + SHARD_ONLY=<i>   run just shard i (this is what CI's matrix does)
#
# BALANCE. Longest suite first into the emptiest shard (LPT), from
# audit/suite-timings.json. A suite with no recorded time is assumed to be the
# median, so a brand-new suite is never the thing that unbalances a run. The
# file is data, not a gate: a stale entry costs seconds, never correctness.
#
# NO RETRIES anywhere. A suite that only passes the second time is a flake and
# the run should say so.
# A SMALL SELECTION RUNS SERIALLY, and that is not a compromise — it is the
# faster answer. A shard's cost is a fresh database plus a server boot (~10s
# of DDL on a new database); six of those to run three suites is slower than
# running three suites against the server that is already up. So sharding is
# the default for the FULL battery and serial is the default for a selection;
# an explicit SHARDS= always wins, either way.
#
# This also keeps `tests/affected.sh` and the pre-push hook behaving exactly
# as they did — they pass a handful of names to an already-booted $BASE.
SHARD_MIN="${SHARD_MIN:-12}"
if [ -z "${SHARDS:-}" ]; then
  # THREE, not six. CHORE-2 retired 238 suites (docs/tests-retired.md); what
  # is left is 35, and a shard's fixed cost is a fresh database plus a server
  # boot. Six shards over 35 suites spends more on starting than it saves on
  # running.
  if [ ${#RUN[@]} -ge "$SHARD_MIN" ]; then SHARDS=3; else SHARDS=1; fi
fi
TIMINGS="${SHARD_TIMINGS:-audit/suite-timings.json}"

# FIX-15 — SHARD_SELF=1 runs even a single shard the sharded way: its own
# database and its own server, instead of an already-booted $BASE. This is what
# the pre-push hook uses when nothing is listening on $BASE.
if [ "$SHARDS" != "1" ] || [ "${SHARD_SELF:-}" = "1" ]; then
  # THE PORT BLOCK. Shard n uses SHARD_PORT_BASE + 10n .. +9, so a run of
  # SHARDS shards needs 10*(SHARDS+1) ports from the base. The base is claimed
  # with an atomic `mkdir` lock holding this run's pid; a block whose lock is
  # held by a live pid, or with any port already listening, is skipped. A stale
  # lock (its pid is gone) is reclaimed. The first block tried is a hash of the
  # worktree tag, so the same worktree usually lands on the same ports.
  if [ -z "${SHARD_PORT_BASE:-}" ]; then
    span=$(( 10 * (SHARDS + 1) ))
    slots=30   # bases 6000..8900 in steps of 100 (clear of 5544, 56xx, 59xx)
    start=$(( $(printf '%s' "$WT_TAG" | cksum | cut -d' ' -f1) % slots ))
    for k in $(seq 0 $((slots - 1))); do
      base=$(( 6000 + 100 * ((start + k) % slots) ))
      lock="/tmp/steward-portblock-$base.lock"
      if ! mkdir "$lock" 2>/dev/null; then
        held=$(cat "$lock/pid" 2>/dev/null || echo "")
        if [ -n "$held" ] && kill -0 "$held" 2>/dev/null; then continue; fi
        rm -rf "$lock"; mkdir "$lock" 2>/dev/null || continue
      fi
      echo $$ >"$lock/pid"
      busy=0
      for p in $(seq "$base" $((base + span - 1))); do
        if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then busy=1; break; fi
      done
      if [ "$busy" -eq 1 ]; then rm -rf "$lock"; continue; fi
      SHARD_PORT_BASE="$base"; PORT_LOCK="$lock"; break
    done
    [ -z "${SHARD_PORT_BASE:-}" ] && { echo "ERROR: no free port block for the shards" >&2; exit 2; }
    trap '[ -n "${PORT_LOCK:-}" ] && rm -rf "$PORT_LOCK"' EXIT
  fi
  export SHARD_PORT_BASE
  echo "[run-all] worktree '$WT_TAG' · databases ${SHARD_DB_PREFIX}<n> · ports from $SHARD_PORT_BASE · logs $LOGDIR"
  SHARD_OUT="${SHARD_OUT:-/tmp/steward-shards-$$}"
  export SHARD_OUT SUITE_LOG_DIR="$LOGDIR"
  rm -rf "$SHARD_OUT"; mkdir -p "$SHARD_OUT"

  # The assignment is computed once, in one place, and written down — so a
  # failure can be reproduced with the exact list that shard was given.
  node scripts/shard-plan.js --shards "$SHARDS" --timings "$TIMINGS" --out "$SHARD_OUT/plan.json" ${RUN[@]+"${RUN[@]}"} \
    || { echo "ERROR: could not plan the shards" >&2; exit 2; }

  # THE BROWSER LEGS' DIST. They are all in one shard (see shard-plan.js) and
  # each checks that client/dist was built against ITS $BASE, skipping quietly
  # when it was not. So the dist is built ONCE, for that shard's API port, and
  # only when there is no usable one already. Without this the browser legs
  # skip and the run is green with the browser coverage missing.
  BSHARD=$(node -e 'const p=require(process.argv[1]);process.stdout.write(String(p.browserShard||""))' "$SHARD_OUT/plan.json")
  if [ -n "$BSHARD" ] && [ "${SHARD_BUILD_DIST:-1}" = "1" ]; then
    bapi=$(( ${SHARD_PORT_BASE:-5700} + 10 * BSHARD ))
    if ! grep -rqs "localhost:$bapi" client/dist/assets 2>/dev/null; then
      echo "[run-all] building client/dist against shard $BSHARD's API (:$bapi) for the browser legs"
      ( cd client && VITE_API_URL="http://localhost:$bapi" VITE_ASSET_ORIGIN="http://localhost:$bapi" \
        VITE_PORTAL_API="http://localhost:$bapi/portal" VITE_ACCOUNT_API="http://localhost:$bapi/account" \
        VITE_NETWORK_API="http://localhost:$bapi/network" npm run build >/dev/null 2>&1 ) \
        || echo "[run-all] WARNING: the client build failed — the browser legs will skip"
    fi
  fi

  echo "[run-all] $SHARDS shards · ${#RUN[@]} suites · plan $SHARD_OUT/plan.json"
  pids=()
  for i in $(seq 1 "$SHARDS"); do
    [ -n "${SHARD_ONLY:-}" ] && [ "$SHARD_ONLY" != "$i" ] && continue
    list=$(node -e 'const p=require(process.argv[1]);process.stdout.write((p.shards[process.argv[2]-1]||[]).map(s=>s.name).join(" "))' "$SHARD_OUT/plan.json" "$i")
    [ -z "$list" ] && continue
    SHARD_N="$i" SHARD_SUITES="$list" bash tests/shard.sh &
    pids+=($!)
  done
  for pid in "${pids[@]}"; do wait "$pid" || true; done

  node scripts/shard-report.js --out "$SHARD_OUT" --plan "$SHARD_OUT/plan.json" --started "$total_start" --timings "$TIMINGS"
  exit $?
fi



# FIX-1 §11 — THE DEMO IS SEEDED BEFORE THE BATTERY, so demo-shape never skips.
# scripts/seed-demo.js drops and recreates ONLY the demo org, against the
# server at $BASE (default :5601) and $DATABASE_URL; it refuses any database
# that is not an allowlisted scratch name. CI seeds it in its own step and
# passes DEMO_SEEDED=1. A seed that fails is a red battery, never a skip.
want_demo=0
for name in "${RUN[@]}"; do [ "$name" = "demo-shape" ] && want_demo=1; done
if [ "$want_demo" -eq 1 ] && [ "${DEMO_SEEDED:-}" != "1" ]; then
  if node scripts/seed-demo.js >"$LOGDIR/seed-demo.log" 2>&1; then
    echo "  seeded the demo org (scripts/seed-demo.js)"
  else
    echo "  FAIL  seed-demo: the demo did not seed ($LOGDIR/seed-demo.log)"
    cat "$LOGDIR/seed-demo.log"
    fail=$((fail+1)); failed+=("seed-demo")
  fi
fi
for name in "${RUN[@]}"; do
  file="tests/${name}.test.js"
  [ -f "$file" ] || { echo "  SKIP  $name (missing)"; continue; }
  log="$LOGDIR/${name}.log"
  t0=$(date +%s)
  node "$file" >"$log" 2>&1
  rc=$?
  t1=$(date +%s)
  secs=$((t1 - t0))
  last=$(tail -1 "$log")
  # THE GATE IS THE EXIT CODE, not the last line.
  #
  # It used to be `[[ "$last" == *"0 failed"* ]]`, and that is a substring
  # match: a suite ending "46 passed, 10 failed" CONTAINS "0 failed" and was
  # printed green. Any suite failing exactly 10, 20, 30 … assertions passed the
  # battery, and the battery is the gate a future build must keep green. Found
  # on 2026-09-24 when build96-sample-data reported "46 passed, 10 failed" and
  # run-all.sh called it PASS.
  #
  # helpers' summary() already does `process.exit(fail ? 1 : 0)`, so the
  # authoritative answer was there the whole time and was being ignored. It is
  # also strictly better than any string match for the case that matters most:
  # a suite that CRASHES before printing a summary at all.
  if [ "$rc" -eq 0 ]; then
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
