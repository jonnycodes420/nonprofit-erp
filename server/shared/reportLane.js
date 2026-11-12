// REPORTS-SPEED-2 · THE REPORT LANE. Reports may use a third of the pool.
//
// On the nightly load test (20 users, 10 orgs) the web's ten connections were
// all in use, with up to 66 requests waiting, and year-over-year took 11.7 s
// at p95. Each report statement takes its connection only for itself (db.js
// query()), but a report sends many, and some at once: Annual asked nine
// figures in parallel, so one Annual held nine of the ten connections and every
// Home, Donors list and profile waited behind it.
//
// Inside a report request (middleware() below, mounted on the report routes),
// every statement on the main pool first takes a place in this lane. There are
// LANE_MAX places per process (a third of DB_POOL_MAX, at least one), shared by
// every report being read, so reports together never hold more than that many
// connections and the rest of the pool stays free for everything else. A place
// is held only while its statement runs, never across JS work in between.
//
// A wait for a place is bounded by the request's own limit (requestLimits:
// 10 s a statement for a report, the same limit as everywhere), and a report
// that runs past it answers 503 with TOO_LONG below, never a 500 or a hang.
// Outside a report request nothing changes. DB_POOL_MAX is not raised: the
// budget is the pooler's (ARCHITECTURE.md, "The connection budget").
//
// /health's pool.reportLane says how many places are in use and the most ever
// (peak), and how many connections report requests hold by ANY path (held,
// heldPeak), so one taken out around the lane (withClient, a transaction) shows.
// In TEST_MODE a report's answer carries X-Steward-Round-Trips: the statements
// it sent after sign-in (tests/reports-speed2.test.js).
"use strict";
const { AsyncLocalStorage } = require("async_hooks");
const LIMITS = require("./requestLimits");
const { POOL_MAX } = require("./pools");

const LANE_MAX = Math.max(1, Math.floor(POOL_MAX / 3));
const TOO_LONG = "This report took too long to run. Try a smaller date range, or try again in a minute.";

const lane = new AsyncLocalStorage();
const state = { inUse: 0, peak: 0, waits: 0, waitTimeouts: 0, queue: [], held: 0, heldPeak: 0 };
// Every connection a report request holds, by any path (a statement in the
// lane, or a client taken out directly with withClient or a transaction):
// requestLimits tells us each time a report's scope takes or gives one back.
const scopes = new Set();
function noteHeld() {
  let n = 0;
  for (const sc of scopes) n += sc.held.size;
  state.held = n; if (n > state.heldPeak) state.heldPeak = n;
}

// Is the current work a report's?
const inLane = () => !!lane.getStore();

function grant() {
  while (state.queue.length && state.inUse < LANE_MAX) {
    const w = state.queue.shift();
    if (w.settled) continue;
    w.settled = true; clearTimeout(w.timer);
    state.inUse++; if (state.inUse > state.peak) state.peak = state.inUse;
    w.resolve();
  }
}
function leave() { state.inUse--; grant(); }

// Take a place for one statement; resolves to the function that gives it back.
async function enter() {
  LIMITS.guard();
  if (state.inUse < LANE_MAX && !state.queue.length) {
    state.inUse++; if (state.inUse > state.peak) state.peak = state.inUse;
    return once(leave);
  }
  state.waits++;
  const sc = LIMITS.live();
  await new Promise((resolve, reject) => {
    const w = { settled: false, resolve, timer: null };
    if (sc) w.timer = setTimeout(() => {
      if (w.settled) return;
      w.settled = true; state.waitTimeouts++; sc.timedOut = true;
      reject(Object.assign(new Error(TOO_LONG), { code: "request_timeout", status: 503 }));
    }, sc.limitMs);
    state.queue.push(w);
  });
  return once(leave);
}
function once(fn) { let done = false; return () => { if (!done) { done = true; fn(); } }; }

// Run one statement in the lane when the current work is a report's.
async function run(fn) {
  const st = lane.getStore();
  if (!st) return fn();
  if (st.req.user) st.statements++;   // the report's own, after sign-in (X-Steward-Round-Trips in TEST_MODE)
  const out = await enter();
  try { return await fn(); } finally { out(); }
}

// Express middleware for the report routes: the rest of the request is in the
// lane, and a statement or wait past the limit says it is the report that took
// too long (requestLimits answers 503 with the scope's sentence).
function middleware(req, res, next) {
  const sc = LIMITS.live();
  const st = { req, statements: 0 };
  if (sc) {
    sc.tooLongMessage = TOO_LONG;
    sc.onHeld = noteHeld; scopes.add(sc);
    const done = () => { scopes.delete(sc); noteHeld(); };
    res.on("finish", done); res.on("close", done);
  }
  if (process.env.TEST_MODE === "1") {
    const head = res.writeHead;
    res.writeHead = function (...a) { if (!res.headersSent) res.setHeader("X-Steward-Round-Trips", String(st.statements)); return head.apply(this, a); };
  }
  lane.run(st, next);
}

const stats = () => ({ max: LANE_MAX, inUse: state.inUse, peak: state.peak, waiting: state.queue.filter(w => !w.settled).length,
  waits: state.waits, waitTimeouts: state.waitTimeouts, held: state.held, heldPeak: state.heldPeak });

module.exports = { LANE_MAX, TOO_LONG, inLane, enter, run, middleware, stats };
