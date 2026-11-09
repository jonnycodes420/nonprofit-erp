// LAG-1 · AFTER A WRITE, THE SCREEN FOLLOWS THE WORKER UNTIL IT IS DONE.
//
// A write the server confirmed is announced at once (api.js, lib/changes.js).
// What the worker does after it (the deck and its tab counts, Drift, scores,
// groups by rule, the stored Insights) lands a second or three later, and
// STALE-1 heard of it only on the bell's 60-second poll: the 30 to 60 seconds
// the 8 Nov fleet measured on production.
//
// Now each write starts a short follow: GET /changes/marks (routes/catchUp.js)
// a moment after the write and then every half second while the server says
// work for this org is pending, for at most 90 seconds. Each table that moved
// is announced (lib/changes.js noteServerChanges), so the views showing it
// re-read the moment the worker's row lands. While work is pending,
// workerPending() is true (onPending tells a listener); a figure the worker
// owns says "Updating…" from its own stale answer rather than show the old
// number as current.
//
// The first answer after a write does not announce again what the write
// itself already announced (its own rows moved those tables), so a gift costs
// what it did before plus what the worker actually changed.
import { noteServerChanges } from "./changes";

const FIRST_MS = 300, BUSY_MS = 500, QUIET_MS = 900, LONGEST_MS = 90000;
let timer = null, until = 0, quiet = 0, fetcher = null, covered = null;
let pending = false;
const subs = new Set();
const setPending = v => { if (v === pending) return; pending = v; for (const s of subs) { try { s(v); } catch { /* one view never stops another */ } } };

async function tick() {
  timer = null;
  let r = null;
  try { r = await fetcher("/changes/marks"); } catch { r = null; }
  const busy = !!(r && r.pending > 0);
  if (r) { noteServerChanges(r, covered); covered = null; }
  setPending(busy);
  quiet = busy ? 0 : quiet + 1;
  if (Date.now() < until && quiet < 2) timer = setTimeout(tick, busy ? BUSY_MS : QUIET_MS);
  else setPending(false);
}

// api.js calls this after each write lands, with its own fetch (no import
// cycle) and the kinds the write already announced.
export function followWorker(fetch, kinds) {
  fetcher = fetch;
  until = Date.now() + LONGEST_MS;
  quiet = 0;
  covered = covered ? new Set([...covered, ...(kinds || [])]) : new Set(kinds || []);
  setPending(true);
  if (!timer) timer = setTimeout(tick, FIRST_MS);
}

export function workerPending() { return pending; }
export function onPending(fn) { subs.add(fn); return () => subs.delete(fn); }
