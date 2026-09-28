#!/usr/bin/env bash
# SPEED workstream — affected-suite selection for the pre-push hook.
#
# Usage:  bash tests/affected.sh <git-range>     # e.g. abc123..def456
#
# Prints to stdout exactly one of:
#   FULL                         → run the whole battery
#   "suite1 suite2 …"            → run only these run-all.sh CORE suites
#   (nothing)                    → nothing test-relevant changed; skip local run
#
# Rules are CONSERVATIVE: anything shared/unclassified → FULL. This script only
# ever narrows the LOCAL pre-push run — CI always runs the full battery.

set -u
cd "$(dirname "$0")/.." || { echo "FULL"; exit 0; }

range="${1:-}"
if [ -z "$range" ]; then echo "FULL"; exit 0; fi

# Invalid/unresolvable range → FULL (never silently skip on a git error).
if ! files=$(git diff --name-only "$range" -- 2>/dev/null); then
  echo "FULL"; exit 0
fi
# Empty diff (e.g. re-push of same sha) → nothing to run.
if [ -z "$files" ]; then exit 0; fi

# CORE list, kept in sync with run-all.sh (parsed from it so it can't drift).
core=$(awk '/^CORE=\(/{f=1;next} /^\)/{f=0} f{print}' tests/run-all.sh | tr -s ' \t' '\n' | grep -v '^$')
in_core() { echo "$core" | grep -qx "$1"; }

# CHORE-2 — the screens are covered by ONE suite now (smoke-walk), so a
# client change runs it plus the few source-scanning guards that survived
# the retirement. See docs/tests-retired.md.
# Suites that read client source or client/dist (verified 2026-08-15 via
# `grep -l 'client/' tests/*.test.js` + manual check that each actually reads
# client files, not just mentions them in a comment). Any client/ change runs
# ALL of these.
CLIENT_SUITES="clickability no-emoji palette upgrade-checkout smoke-walk gtm1a-internal-price"

suites=""
add_suite() {
  case " $suites " in *" $1 "*) ;; *) suites="$suites $1" ;; esac
}

while IFS= read -r f; do
  case "$f" in
    # Shared server/runtime surface → everything could be affected.
    server.js|db.js|auth.js|branding.js|publicUrl.js|stripeKeys.js|billingPlans.js|assetStore.js|package.json|package-lock.json)
      echo "FULL"; exit 0 ;;
    routes/*|.github/*)
      echo "FULL"; exit 0 ;;
    # Shared test infrastructure → a narrowed run could mask a breakage.
    tests/helpers.js|tests/run-all.sh|tests/shard.sh)
      echo "FULL"; exit 0 ;;
    # A suite's own file → run that suite (only if it's in the standard run).
    tests/*.test.js)
      name=$(basename "$f" .test.js)
      if in_core "$name"; then add_suite "$name"; fi ;;
    # Client source → the client-facing subset.
    client/*)
      for s in $CLIENT_SUITES; do
        if in_core "$s"; then add_suite "$s"; fi
      done ;;
    # Docs/audit/scripts/markdown → no local suites needed (CI still runs full).
    docs/*|audit/*|scripts/*|*.md) ;;
    # Anything we can't classify → FULL. Conservative by design.
    *)
      echo "FULL"; exit 0 ;;
  esac
done <<EOF
$files
EOF

suites="${suites# }"
if [ -n "$suites" ]; then echo "$suites"; fi
exit 0
