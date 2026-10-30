# tests/lib/battery-lock.sh — the machine-wide locks, sourced by tests/run-all.sh
# (the battery lock and the shard port blocks) and by tests/battery-lock.test.js.
#
# A lock is a directory made with an atomic `mkdir`, holding `pid` (and `who`).
# FIX-58: A RUN NEVER DELETES A LOCK IT DOES NOT OWN. FIX-57's battery deleted
# SECURE-2's. The hole was the stale takeover: runs waiting on a dead owner's
# lock all read the same dead pid; the first removed it and took the lock, and
# the next, acting on the pid it had read a moment before, removed the NEW
# owner's lock. So:
#   · a lock is removed by lock_release only when its pid is ours;
#   · a stale lock is removed only under a takeover mutex (`<lock>.takeover`),
#     after re-reading the pid INSIDE the mutex: if it is no longer the dead pid
#     we saw, somebody else took it and we leave it alone;
#   · a lock with no pid yet is a run between its mkdir and its pid write, and
#     is stale only when it has had no pid for LOCK_EMPTY_S (10 s) seconds.

# lock_try DIR WHO → 0 when this process now holds DIR.
lock_try() {
  mkdir "$1" 2>/dev/null || return 1
  echo $$ >"$1/pid"; [ -n "${2:-}" ] && echo "$2" >"$1/who"
  return 0
}

# lock_take_stale DIR SEEN → removes DIR only if its pid is still SEEN (a dead
# pid, or "" for a lock that has had no pid for LOCK_EMPTY_S). Returns 0 when it
# removed it. Never removes a lock that has changed hands.
lock_take_stale() {
  local dir="$1" seen="$2" mutex="$1.takeover" now mpid removed=1
  if ! mkdir "$mutex" 2>/dev/null; then
    # A takeover whose process died inside the mutex would block every later
    # one; its pid says so. (Removing a dead process's mutex is safe: the pid
    # re-read below is still what protects the lock itself.)
    mpid=$(cat "$mutex/pid" 2>/dev/null || echo "")
    if [ -n "$mpid" ] && ! kill -0 "$mpid" 2>/dev/null; then rm -rf "$mutex"; fi
    return 1
  fi
  echo $$ >"$mutex/pid"
  now=$(cat "$dir/pid" 2>/dev/null || echo "")
  if [ -d "$dir" ] && [ "$now" = "$seen" ]; then
    if [ -z "$now" ] || ! kill -0 "$now" 2>/dev/null; then rm -rf "$dir"; removed=0; fi
  fi
  rm -rf "$mutex"
  return $removed
}

# lock_acquire DIR WHO → waits until this process holds DIR. Calls
# lock_on_wait PID WHO and lock_on_stale PID when they are defined.
lock_acquire() {
  local dir="$1" who="${2:-}" held said="" empty_since="" t0
  t0=$(date +%s); LOCK_WAITED=0
  while :; do
    if lock_try "$dir" "$who"; then LOCK_WAITED=$(( $(date +%s) - t0 )); return 0; fi
    held=$(cat "$dir/pid" 2>/dev/null || echo "")
    if [ -n "$held" ] && kill -0 "$held" 2>/dev/null; then
      empty_since=""
      if [ "$said" != "$held" ]; then
        declare -F lock_on_wait >/dev/null && lock_on_wait "$held" "$(cat "$dir/who" 2>/dev/null || echo "?")"
        said="$held"
      fi
      sleep "${LOCK_POLL_S:-2}"; continue
    fi
    if [ -z "$held" ]; then
      # Gone between our mkdir and our read (just released): try again. A
      # waiter that went on to the takeover here removed the NEXT owner's lock
      # before its pid was written.
      if [ ! -d "$dir" ]; then empty_since=""; continue; fi
      # No pid yet: give its writer LOCK_EMPTY_S before calling it stale.
      [ -z "$empty_since" ] && empty_since=$(date +%s)
      if [ $(( $(date +%s) - empty_since )) -lt "${LOCK_EMPTY_S:-10}" ]; then sleep 0.5; continue; fi
    else
      empty_since=""
    fi
    if lock_take_stale "$dir" "$held"; then
      declare -F lock_on_stale >/dev/null && lock_on_stale "${held:-none}"
    else
      sleep 0.2
    fi
  done
}

# lock_release DIR → removes DIR only when this process owns it.
lock_release() {
  [ -n "${1:-}" ] && [ "$(cat "$1/pid" 2>/dev/null)" = "$$" ] && rm -rf "$1"
  return 0
}
