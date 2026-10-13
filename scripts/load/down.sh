#!/usr/bin/env bash
# SCALE-1 · stop exactly the processes scripts/load/up.sh started.
LOAD_DIR="${LOAD_DIR:-$HOME/steward-scale-pg}"
[ -f "$LOAD_DIR/pids" ] || exit 0
while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$LOAD_DIR/pids"
rm -f "$LOAD_DIR/pids" "$LOAD_DIR/server.pid"
