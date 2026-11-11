# tests/lib/run-suite.sh · FLAKE-4. RUN ONE SUITE, AND A FAILED ONE ONCE MORE.
#
# Sourced by tests/shard.sh. `run_suite <name> <file> <log>` runs the suite
# with its output in <log>. If it fails and tests/lib/retryPolicy.js allows it,
# the first run's log is kept as <name>.try1.log and the suite runs again in
# the same shard, against the same server and database:
#   · passes the second time → green, and named: SUITE_FLAKY=1 and the line
#     "FLAKY: <name> passed on retry" (flaky.json and the PR comment read it)
#   · fails the second time  → red, as before
# Never retried: tenant-matrix, security, any suite tagged @no-retry, and
# anything at all when SHARD_RETRY=0 (the Repeat workflow counts every red).
#
# Sets: SUITE_RC SUITE_TRIES SUITE_FLAKY SUITE_FIRST_LAST SUITE_NO_RETRY
RUN_SUITE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_suite() {
  local name="$1" file="$2" log="$3" why
  SUITE_TRIES=1; SUITE_FLAKY=0; SUITE_FIRST_LAST=""; SUITE_NO_RETRY=""
  node "$file" >"$log" 2>&1
  SUITE_RC=$?
  [ "$SUITE_RC" -eq 0 ] && return 0
  if [ "${SHARD_RETRY:-1}" != "1" ]; then SUITE_NO_RETRY="SHARD_RETRY=0"; return 0; fi
  if ! why=$(node "$RUN_SUITE_DIR/retryPolicy.js" "$name" "$file"); then
    SUITE_NO_RETRY="${why:-the retry policy said no}"
    return 0
  fi
  SUITE_FIRST_LAST=$(tail -1 "$log" | tr -d '\r' | cut -c1-300)
  cp "$log" "${log%.log}.try1.log" 2>/dev/null || true
  echo "  retry [${SHARD_N:-?}] $name failed once ($SUITE_FIRST_LAST); running it again"
  SUITE_TRIES=2
  node "$file" >"$log" 2>&1
  SUITE_RC=$?
  if [ "$SUITE_RC" -eq 0 ]; then
    SUITE_FLAKY=1
    echo "FLAKY: $name passed on retry"
  fi
  return 0
}
