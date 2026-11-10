// SCALE-3 · THE CAPACITY GAUGE. WHEN TO ADD A WEB REPLICA, WHEN TO GIVE THE
// WORKER MORE ROOM.
//
// SCALE-2 found the next limit is one web process at a full core, not the
// database. A second web replica and a bigger worker are Railway settings
// Jonathan changes (docs/needs-jonathan/SCALE-3.md); this says when.
//
// Every process samples itself and writes one row to capacity_samples every
// five minutes: event-loop lag p95 and busy time (perf_hooks
// monitorEventLoopDelay and eventLoopUtilization), request p95 across every
// route, the wait for a database connection (p95) and the most connections in
// use at once, and, from the queue's own health, the oldest waiting job and
// the jobs that failed in the last hour. /ops reads the last seven days and
// summarize() (pure, so the suite feeds it a fixture) colours each line
// against the threshold written beside it and says what to do.
//
// Timing and counts only: no route, no org, no person is stored.
"use strict";
const os = require("os");
const { monitorEventLoopDelay, performance } = require("perf_hooks");

const EVERY_MS = () => Number(process.env.CAPACITY_SAMPLE_MS) || 5 * 60 * 1000;   // a walk sets it shorter
const KEEP_DAYS = 8;
const DAY_MS = 24 * 3600e3;
const TZ = "America/New_York";   // Jonathan's days and nights

// Each line: its label, its unit, and the threshold written beside it.
// amber at or over `amber`, red over `red` (`lowIsBad` for none here).
const LINES = [
  { key: "lagP95", label: "Web event-loop lag (p95)", unit: "ms", amber: 50, red: 100, web: true },
  { key: "busyPct", label: "Web busy time", unit: "%", amber: 60, red: 85, web: true },
  { key: "reqP95", label: "Request time, every route (p95)", unit: "ms", amber: 500, red: 800, web: true },
  { key: "poolWaitP95", label: "Wait for a database connection (p95)", unit: "ms", amber: 50, red: 250 },
  { key: "poolPeakPct", label: "Most database connections in use", unit: "% of the pool", amber: 70, red: 90 },
  { key: "queueOldestS", label: "Oldest waiting job", unit: "s", amber: 120, red: 600, worker: true },
  { key: "failedHour", label: "Jobs failed in the last hour", unit: "", amber: 1, red: 6, worker: true },
];
const SAY = {
  replica: "Add a second web replica: event-loop lag p95 has been over 100 ms, or request p95 over 800 ms, three days in a row.",
  worker: "Give the worker more room: the oldest job has waited over 10 minutes three nights in a row.",
  both: "Add a second web replica and give the worker more room: the web has been over its line three days in a row, and jobs have waited over 10 minutes three nights in a row.",
  none: "Nothing to add: one web process and one worker are keeping up.",
  watch: "Nothing to add yet: the web is over its line today, and a second replica is for three days in a row.",
  empty: "No samples yet: each process writes one every five minutes.",
};

const pct = (arr, p) => {
  const s = arr.filter(v => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p / 100 * s.length) - 1))];
};
const colourOf = (line, v) => (v == null ? null : v >= line.red ? "red" : v >= line.amber ? "amber" : "green");
// Jonathan's calendar day of a timestamp, and whether it is night (midnight to 6 AM).
const dayOf = (t) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
const hourOf = (t) => Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));

// The value of a line over a set of samples: p95 of the per-sample p95s for
// timings, the mean for busy time, the most for peaks, waits and failures.
function valueOf(key, rows) {
  const v = rows.map(r => r[key]);
  if (key === "busyPct") { const n = v.filter(x => x != null).map(Number); return n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : null; }
  if (key === "lagP95" || key === "reqP95" || key === "poolWaitP95") { const p = pct(v, 95); return p == null ? null : Math.round(p); }
  const n = v.filter(x => x != null).map(Number);
  return n.length ? Math.max(...n) : null;
}

// rows: [{ at, process, role, lagP95, busyPct, reqP95, poolWaitP95, poolPeakPct, queueOldestS, failedHour }]
// load: /ops's nightly load report ({ ok, level: "ok"|"red"|null, detail, at }).
function summarize(rows, load, now = Date.now()) {
  const within = (ms) => rows.filter(r => now - new Date(r.at).getTime() <= ms && new Date(r.at).getTime() <= now);
  const windows = { day: within(DAY_MS), week: within(7 * DAY_MS) };
  const webRows = (rs) => rs.filter(r => r.role !== "worker");
  const workerRows = (rs) => rs.filter(r => r.role !== "web");
  const pick = (line, rs) => (line.web ? webRows(rs) : line.worker ? workerRows(rs) : rs);
  const lines = [];
  for (const line of LINES) {
    if (line.web) {
      // Per replica: one line for each web process heard from this week.
      const procs = [...new Set(webRows(windows.week).map(r => r.process))].sort();
      for (const p of procs.length ? procs : [null]) {
        const of = rs => webRows(rs).filter(r => p == null || r.process === p);
        const day = valueOf(line.key, of(windows.day)), week = valueOf(line.key, of(windows.week));
        lines.push({ key: line.key, label: procs.length > 1 ? `${line.label}, ${p}` : line.label, unit: line.unit,
          threshold: `amber at ${line.amber}, red at ${line.red}`, day, week, dayColour: colourOf(line, day), weekColour: colourOf(line, week) });
      }
      continue;
    }
    const day = valueOf(line.key, pick(line, windows.day)), week = valueOf(line.key, pick(line, windows.week));
    lines.push({ key: line.key, label: line.label, unit: line.unit, threshold: `amber at ${line.amber}, red at ${line.red}`,
      day, week, dayColour: colourOf(line, day), weekColour: colourOf(line, week) });
  }
  const loadColour = !load || !load.level ? null : load.level === "ok" ? "green" : "red";
  lines.push({ key: "load", label: "Nightly load test (20 users, 10 orgs)", unit: "", threshold: "green when every route is inside its bar",
    day: load && load.detail ? load.detail : "not read yet", week: null, dayColour: loadColour, weekColour: null });

  // The advice: three days (or nights) in a row, the last three that have samples.
  const byDay = new Map();
  for (const r of windows.week) { const d = dayOf(r.at); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(r); }
  const days = [...byDay.keys()].sort().slice(-3);
  const threeInARow = (test) => days.length === 3 && days.every(d => test(byDay.get(d)));
  const webOver = (rs) => { const w = webRows(rs); const lag = valueOf("lagP95", w), req = valueOf("reqP95", w);
    return (lag != null && lag > 100) || (req != null && req > 800); };
  const nightOver = (rs) => { const night = workerRows(rs).filter(r => hourOf(r.at) < 6); const o = valueOf("queueOldestS", night);
    return o != null && o > 600; };
  const replica = threeInARow(webOver), worker = threeInARow(nightOver);
  const today = days.length ? byDay.get(days[days.length - 1]) : [];
  const advice = !rows.length ? "empty" : replica && worker ? "both" : replica ? "replica" : worker ? "worker" : today.length && webOver(today) ? "watch" : "none";
  return { lines, advice, sentence: SAY[advice], days, samples: windows.week.length,
    definition: "Each process writes one sample every five minutes. The day column is the last 24 hours, the week column the last 7 days: timings are the p95 of the samples' p95s, busy time is the average, the rest are the most seen." };
}

// ── sampling (one per process) ───────────────────────────────────────────
const state = { lag: null, elu: null, req: [], waits: [], peak: 0, timer: null, poll: null, started: false };
const RESERVOIR = 4000;
const keep = (arr, v) => { if (arr.length < RESERVOIR) arr.push(v); else arr[Math.floor(Math.random() * arr.length)] = v; };

// Request time across every route: from arrival to the answer's last byte.
function middleware(req, res, next) {
  const t0 = performance.now();
  res.on("finish", () => keep(state.req, performance.now() - t0));
  next();
}
// The wait for a connection (server/shared/requestLimits.js checkout).
function noteWait(ms) { keep(state.waits, ms); }

const processName = () => process.env.RAILWAY_REPLICA_ID ? `replica ${String(process.env.RAILWAY_REPLICA_ID).slice(0, 8)}` : `${os.hostname()}:${process.pid}`;

async function ensureTable(run) {
  // A table of its own, created once; additive, and it waits at most 5 s for a lock.
  for (let i = 0; i < 3; i++) {
    try {
      await run(`DO $$ BEGIN SET LOCAL lock_timeout = '5s';
        CREATE TABLE IF NOT EXISTS capacity_samples (
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(), process TEXT NOT NULL, role TEXT NOT NULL,
          lag_p95 REAL, busy_pct REAL, req_p95 REAL, req_n INTEGER, pool_wait_p95 REAL, pool_peak INTEGER, pool_max INTEGER,
          queue_oldest_s INTEGER, failed_hour INTEGER);
        CREATE INDEX IF NOT EXISTS idx_capacity_samples_at ON capacity_samples (at); END $$`, []);
      return true;
    } catch (e) { if (i === 2) { console.error("[capacity] table", e.message); return false; } await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
  }
}

async function flush({ run, role, poolStats, queueHealth }) {
  const lag = state.lag ? state.lag.percentile(95) / 1e6 : null;
  const eluNow = performance.eventLoopUtilization();
  const busy = state.elu ? performance.eventLoopUtilization(eluNow, state.elu).utilization * 100 : null;
  state.elu = eluNow;
  if (state.lag) state.lag.reset();
  const req = pct(state.req, 95), n = state.req.length, wait = pct(state.waits, 95);
  const p = poolStats() || {};
  const q = (queueHealth() || {}).queue || {};
  const worker = role !== "web";
  state.req = []; state.waits = [];
  const peak = state.peak; state.peak = 0;
  await run(`INSERT INTO capacity_samples (process, role, lag_p95, busy_pct, req_p95, req_n, pool_wait_p95, pool_peak, pool_max, queue_oldest_s, failed_hour)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [processName(), role, lag, busy, req, n, wait, peak, p.max || null,
     worker && q.oldestWaitingSeconds != null ? q.oldestWaitingSeconds : null, worker && q.failedLastHour != null ? q.failedLastHour : null]);
  await run(`DELETE FROM capacity_samples WHERE at < NOW() - (? * INTERVAL '1 day')`, [KEEP_DAYS]);
}

// Started once per process at boot. Off with DISABLE_BACKGROUND_TICKS (the battery) unless CAPACITY_SAMPLE_MS is set.
function start({ run, role, poolStats, queueHealth }) {
  if (state.started || (process.env.DISABLE_BACKGROUND_TICKS === "1" && !process.env.CAPACITY_SAMPLE_MS)) return false;
  state.started = true;
  state.lag = monitorEventLoopDelay({ resolution: 20 });
  state.lag.enable();
  state.elu = performance.eventLoopUtilization();
  state.poll = setInterval(() => { const p = poolStats() || {}; const used = (p.total || 0) - (p.idle || 0); if (used > state.peak) state.peak = used; }, 1000);
  state.poll.unref();
  ensureTable(run).then(ok => {
    if (!ok) return;
    state.timer = setInterval(() => flush({ run, role: role(), poolStats, queueHealth }).catch(e => console.error("[capacity] sample", e.message)), EVERY_MS());
    state.timer.unref();
  });
  return true;
}

// /ops: the last seven days, summarized.
async function read(query, load, now = Date.now()) {
  let rows = [];
  try {
    rows = (await query(`SELECT at, process, role, lag_p95, busy_pct, req_p95, pool_wait_p95, pool_peak, pool_max, queue_oldest_s, failed_hour
                           FROM capacity_samples WHERE at > NOW() - INTERVAL '7 days' ORDER BY at`, [])).map(fromRow);
  } catch (_) { /* the table is made by the first process that samples */ }
  return summarize(rows, load, now);
}
const num = v => (v == null ? null : Number(v));
const fromRow = r => ({ at: new Date(r.at).toISOString(), process: r.process, role: r.role, lagP95: num(r.lag_p95), busyPct: num(r.busy_pct),
  reqP95: num(r.req_p95), poolWaitP95: num(r.pool_wait_p95),
  poolPeakPct: r.pool_max ? Math.round(Number(r.pool_peak) / Number(r.pool_max) * 100) : null,
  queueOldestS: num(r.queue_oldest_s), failedHour: num(r.failed_hour) });

module.exports = { LINES, SAY, summarize, middleware, noteWait, start, read, flush, fromRow };
