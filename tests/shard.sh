#!/usr/bin/env bash
# tests/shard.sh — CHORE-2. ONE SHARD: its own database, its own server, its
# own ports, and the suites it was given.
#
# run-all.sh is still the entry point. When it shards, it calls this file once
# per shard, in parallel, and then aggregates. Nothing here decides WHICH
# suites run — that is run-all.sh's job — so a sharded run and a serial run
# execute exactly the same list.
#
# WHY A DATABASE PER SHARD, AND NOT A SCHEMA PER SHARD
# Suites delete by `org_id` and several delete whole tables; two shards sharing
# one database would delete each other's fixtures and report it as a product
# bug. That failure mode is already documented (CLAUDE.md, "Separate database
# per worktree") and it is the same rule one level down.
#
# WHY A SERVER PER SHARD
# The suites talk to $BASE over HTTP and several of them drive ops routes that
# mutate server state. One server for six shards would serialise them behind
# its own event loop and interleave their sweeps.
#
# PORTS. Shard n (1-based) gets a block of ten from PORT_BASE (default 5700):
#   api = 5700+10n · sink = +1 · stripe = +2 · billing = +3 · preview = +4
# Nothing in the block collides with the documented worktree ports (5601,
# 59xx) or with the donor-accounts child server's fixed :5611.
#
# FIX-15 · TWO WORKTREES AT ONCE. The database prefix and the port base both
# come from run-all.sh, which derives them from the worktree (see its
# "WORKTREE IDENTITY" block). The defaults below are only for a hand-run shard.
#
# Usage (run-all.sh does this for you):
#   SHARD_N=1 SHARD_SUITES="tasks greeting" bash tests/shard.sh
#
# Emits: $SHARD_OUT/shard-<n>.json  — one line per suite: name, rc, secs, last
set -u
cd "$(dirname "$0")/.."

N="${SHARD_N:?SHARD_N is required}"
SUITES_IN="${SHARD_SUITES:-}"
OUT="${SHARD_OUT:-/tmp/steward-shards}"
PORT_BASE="${SHARD_PORT_BASE:-5700}"
PGHOSTP="${SHARD_PGPORT:-5544}"
PGUSER_="${SHARD_PGUSER:-steward}"
DBNAME="${SHARD_DB_PREFIX:-steward_shard_}$N"
KEEP_DB="${SHARD_KEEP_DB:-0}"

api=$((PORT_BASE + 10 * N))
sink=$((api + 1)); stripe=$((api + 2)); billing=$((api + 3)); preview=$((api + 4))
# FIX-11 Part 5 — the stand-in for Resend's RECEIVING api, which is a different
# API from the one RESEND_BASE_URL points at (that is the mail sink). Inside
# this shard's own block, so three shards do not fight over one port.
recv=$((api + 7))
# INT-BUILD-1 — the stand-in for Google Calendar, which intb1-calendar-store
# answers on. Inside this shard's block like every other mock.
cal=$((api + 8))
mkdir -p "$OUT"
LOGDIR="${SUITE_LOG_DIR:-/tmp/steward-suite-logs}/shard-$N"
mkdir -p "$LOGDIR"
rm -f "$LOGDIR"/*.log 2>/dev/null || true
SERVER_LOG="$OUT/server-$N.log"

say() { echo "[shard $N] $*"; }

# ── the database ───────────────────────────────────────────────────────────
# FRESH each run: a shard that inherits yesterday's rows is a shard whose
# green means nothing. `dropdb --if-exists` then `createdb`; the server's boot
# builds the whole schema and the demo seed (db.js's schema_meta fast path
# does NOT apply to a brand-new database, which is what we want here).
if [ "${SHARD_REUSE_DB:-0}" != "1" ]; then
  dropdb -h localhost -p "$PGHOSTP" -U "$PGUSER_" --if-exists "$DBNAME" >/dev/null 2>&1 || true
  createdb -h localhost -p "$PGHOSTP" -U "$PGUSER_" "$DBNAME" || { say "could not create $DBNAME"; exit 2; }
fi
DBURL="postgresql://${PGUSER_}@localhost:${PGHOSTP}/${DBNAME}"

# ── the server ─────────────────────────────────────────────────────────────
# The boot env is the one documented in this file's sibling run-all.sh header,
# with every port moved into this shard's block. CORS_ORIGIN points at THIS
# shard's preview, because the browser legs fetch cross-origin and a mismatch
# reads as a broken app rather than a missing variable.
start_server() {
  DATABASE_URL="$DBURL" DB_SSL="${DB_SSL:-disable}" JWT_SECRET=local-test-secret \
  PORT="$api" TEST_MODE=1 SESSION_CACHE_TTL_MS=0 RESEND_API_KEY=re_dummy_local \
  RESEND_BASE_URL="http://localhost:$sink" DEMO_SMTP_FROM=noreply@stewardapp.dev \
  STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_localtest \
  INTUIT_API_BASE="http://localhost:$((api + 5))" XERO_API_BASE="http://localhost:$((api + 6))" \
  PAYPAL_WEBHOOK_ID="$(node -e 'process.stdout.write(require("./tests/fixtures/paypal-webhook-test-key").WEBHOOK_ID)')" \
  PAYPAL_WEBHOOK_TEST_CERT="$(node -e 'process.stdout.write(require("./tests/fixtures/paypal-webhook-test-key").PUBLIC_PEM)')" \
  RESEND_WEBHOOK_SECRET=whsec_YnVpbGQ5NC1sb2NhbC13ZWJob29rLXNlY3JldCE= \
  STRIPE_API_BASE="http://localhost:$stripe" \
  DONOR_ACCOUNTS_ENABLED=1 NETWORK_SIGNUP_ENABLED=1 \
  MIGC_CONTACT_EMAIL=migc-contact@example.org MIGC_EMAIL_FROM=noreply@stewardapp.dev \
  DISABLE_BACKGROUND_TICKS=1 CORS_ORIGIN="http://localhost:$preview" \
  STEWARD_CREDENTIAL_KEY="${STEWARD_CREDENTIAL_KEY:-local-scratch-credential-key-0123456789}" \
  FOUNDER_EMAIL=jonathan@stewardapp.dev \
  STRIPE_BILLING_SECRET_KEY=sk_test_dummy \
  STRIPE_BILLING_API_BASE="http://localhost:$billing" \
  STRIPE_PRICE_FOUNDING=price_test_founding \
  STRIPE_PRICE_CORE=price_test_core STRIPE_PRICE_TEAM=price_test_team \
  INBOUND_EMAIL_ENABLED=1 INBOUND_EMAIL_DOMAIN=log.stewardapp.dev \
  INBOUND_EMAIL_SECRET=local-inbound-secret \
  RESEND_RECEIVING_BASE_URL="http://localhost:$recv" \
  GOOGLE_CALENDAR_API_BASE="http://localhost:$cal" \
  GMAIL_API_BASE="http://localhost:$cal" \
  node server.js >"$SERVER_LOG" 2>&1 &
  echo $!
}
SRV_PID=$(start_server)

PREV_PID=""
# The browser legs need the built client served on this shard's own port, with
# the API rewrites pointed at this shard's API. One dist is shared (run-all.sh
# builds it once); only the proxy target differs per shard.
if [ -f client/dist/index.html ] && [ "${SHARD_PREVIEW:-1}" = "1" ]; then
  API="http://localhost:$api" PORT="$preview" node scripts/local-preview.js >"$OUT/preview-$N.log" 2>&1 &
  PREV_PID=$!
fi

cleanup() {
  # Quietly: a killed background job prints "Terminated" to the shell's own
  # stderr, which in a six-way parallel run is six lines of noise around the
  # one summary that matters.
  [ -n "${SRV_PID:-}" ] && { kill "$SRV_PID" 2>/dev/null || true; }
  [ -n "${PREV_PID:-}" ] && { kill "$PREV_PID" 2>/dev/null || true; }
  wait "$SRV_PID" "$PREV_PID" 2>/dev/null || true
  if [ "$KEEP_DB" != "1" ] && [ "${SHARD_REUSE_DB:-0}" != "1" ]; then
    dropdb -h localhost -p "$PGHOSTP" -U "$PGUSER_" --if-exists "$DBNAME" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Wait for the schema build. A brand-new database runs the full DDL, which is
# the slowest part of a shard's start-up; 180s is generous on purpose, because
# a timeout here would be reported as a suite failure and it is not one.
ready=0
for _ in $(seq 1 180); do
  if curl -sf "http://localhost:$api/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  say "server did not come up on :$api — see $SERVER_LOG"
  tail -30 "$SERVER_LOG" || true
  printf '{"shard":%s,"error":"server did not start","suites":[]}\n' "$N" >"$OUT/shard-$N.json"
  exit 2
fi

export BASE="http://localhost:$api"
export APP_URL="http://localhost:$preview"
export DATABASE_URL="$DBURL"
# FIX-11 Part 5 — the inbound suite stands up its own Resend-receiving mock and
# binds THIS port, which is the one the server above was told to call. Without
# these three the suite skips, and a suite that skips in CI is coverage that is
# not there (GTM-1a A).
export INBOUND_EMAIL_SECRET=local-inbound-secret
export INBOUND_EMAIL_DOMAIN=log.stewardapp.dev
export RESEND_RECV_PORT="$recv"
export DB_SSL="${DB_SSL:-disable}"
export SINK_PORT="$sink"
export STRIPE_MOCK_PORT="$stripe"
export BILLING_MOCK_PORT="$billing"
# INT-2 — the accounting-system mock this shard's server was told to call. It
# lives inside the shard's own block of ten (+5/+6), like every other mock.
export BOOKKEEPING_MOCK_PORT="$((api + 5))"
export XERO_MOCK_PORT="$((api + 6))"
export CALENDAR_MOCK_PORT="$cal"
# FIX-15 — the two suites that boot server.js IN-PROCESS (tenant-matrix,
# fix11-audit-trail) used fixed ports, :5697 and :5698, which two worktrees'
# batteries both bound. Suites run serially inside a shard, so both share the
# last free port of this shard's block.
export MATRIX_PORT="$((api + 9))"
export AUDIT_PORT="$((api + 9))"

# ── THE DEMO SEED ──────────────────────────────────────────────────────────
# FIVE suites read the demo org, not one: demo-shape, fix3-c-demo-people,
# fix3-c-demo-giving, fix1-walk and script-guards. Serially they all shared
# the single seed run-all.sh did up front; sharded, each shard has its OWN
# database, so EVERY shard holding any of them has to seed its own.
#
# The first cut of this seeded only for demo-shape, and fix3-c-demo-giving
# landed in another shard and failed with "the demo org is not seeded" —
# which reads as a product bug and was an environment one.
#
# The list is derived, not hand-kept: a suite needs the demo if it names the
# demo org or says so itself. A seed that fails is a loud line, never a skip.
needs_demo=0
for name in $SUITES_IN; do
  f="tests/${name}.test.js"
  [ -f "$f" ] || continue
  if grep -qE 'org_b72demo|the demo org is not seeded|run-all seeds it before the battery|seed-demo' "$f" 2>/dev/null; then needs_demo=1; break; fi
done
if [ "$needs_demo" -eq 1 ] && [ "${DEMO_SEEDED:-}" != "1" ]; then
  if node scripts/seed-demo.js >"$LOGDIR/seed-demo.log" 2>&1; then
    say "seeded the demo org"
  else
    say "seed-demo FAILED — see $LOGDIR/seed-demo.log"
    tail -5 "$LOGDIR/seed-demo.log" || true
  fi
fi

# ── the suites ─────────────────────────────────────────────────────────────
# Serial within a shard, deliberately: the parallelism is the shard, and two
# suites in one process tree sharing one database is the collision this whole
# file exists to avoid. NO RETRIES — a suite that only passes on the second
# run is a flake, and hiding it is how a flake becomes a habit.
rows=""
for name in $SUITES_IN; do
  file="tests/${name}.test.js"
  if [ ! -f "$file" ]; then
    rows="$rows{\"name\":\"$name\",\"rc\":0,\"secs\":0,\"missing\":true,\"last\":\"missing\"},"
    continue
  fi
  log="$LOGDIR/${name}.log"
  t0=$(date +%s)
  node "$file" >"$log" 2>&1
  rc=$?
  t1=$(date +%s)
  secs=$((t1 - t0))
  last=$(tail -1 "$log" | tr -d '\r' | sed 's/\\/\\\\/g; s/"/\\"/g' | cut -c1-300)
  # `grep -c` PRINTS 0 and EXITS 1 when it matches nothing, so `|| echo 0`
  # appends a SECOND zero and the JSON line below becomes unparseable — the
  # shard then reads to the reporter as "produced no result" and a green run
  # is announced as a broken one. `|| true` keeps the count it already printed.
  skips=$(grep -c "SKIP" "$log" 2>/dev/null || true); skips=${skips:-0}
  # GTM-1a A — a LEG skip is the whole browser half of a suite not running,
  # and it is the only kind that makes a pass count incomparable. An
  # informational SKIP inside a suite (smoke-walk names a tab hidden from the
  # CRM for that org) is the suite working, and must not buy an exemption
  # from the count ratchet. helpers' browserLegOrSkip prints the marker.
  legskips=$(grep -c "\[leg-skip\]" "$log" 2>/dev/null || true); legskips=${legskips:-0}
  # ONE SUMMARY. scripts/shard-report.js prints every suite once, at the end,
  # in name order — six shards interleaving their own PASS lines is not a
  # summary, it is six of them. A FAILURE still shows the moment it happens,
  # because waiting six minutes to learn something broke in the first ten
  # seconds is its own kind of slow.
  if [ "$rc" -ne 0 ]; then
    printf "  \033[31mFAIL\033[0m  [%s] %-26s %4ss  %s\n" "$N" "$name" "$secs" "$last"
  fi
  rows="$rows{\"name\":\"$name\",\"rc\":$rc,\"secs\":$secs,\"skips\":$skips,\"legSkips\":$legskips,\"last\":\"$last\"},"
done

printf '{"shard":%s,"api":%s,"db":"%s","suites":[%s]}\n' "$N" "$api" "$DBNAME" "${rows%,}" >"$OUT/shard-$N.json"
