#!/usr/bin/env bash
# SCALE-1 · start the stand-ins and a load server against the seeded load
# database, with every background job held by tick-capture.js so the run
# decides when jobs fire. Writes the PIDs it started to $LOAD_DIR/pids; stop
# them with scripts/load/down.sh (only those PIDs, never by name).
#
#   bash scripts/load/up.sh            # then node scripts/load/measure.js all
set -euo pipefail
cd "$(dirname "$0")/../.."
LOAD_DIR="${LOAD_DIR:-$HOME/steward-scale-pg}"
mkdir -p "$LOAD_DIR"
source scripts/load/env.sh
node scripts/load/standins.js > "$LOAD_DIR/standins.log" 2>&1 &
echo $! >> "$LOAD_DIR/pids"
# Production-shaped: no TEST_MODE, so the rate limiters and retry timers are
# the real ones. Jobs are held, not disabled, so they can be timed.
# CAPTURE=1 holds every job for scripts/load/measure.js tick (part 1's way of
# timing jobs); without it the queue schedules and runs them for real.
if [ "${CAPTURE:-0}" = "1" ]; then
  TICK_LOG="$LOAD_DIR/tick.jsonl" node -r ./scripts/load/tick-capture.js server.js > "$LOAD_DIR/server.log" 2>&1 &
else
  node server.js > "$LOAD_DIR/server.log" 2>&1 &
fi
echo $! >> "$LOAD_DIR/pids"
echo $! > "$LOAD_DIR/server.pid"
for _ in $(seq 1 120); do
  curl -sf "http://localhost:${PORT}/health" >/dev/null && { echo "load server up on :${PORT} (pid $(cat "$LOAD_DIR/server.pid"))"; exit 0; }
  sleep 1
done
echo "load server did not come up; see $LOAD_DIR/server.log"; exit 1
