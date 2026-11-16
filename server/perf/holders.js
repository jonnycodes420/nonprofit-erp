// SCALE-4 · WHO HELD THE DATABASE. The Capacity card said "Most database
// connections in use: 100%" for a day and a week, and nothing said whose they
// were. Every connection passes through requestLimits.checkout and release, so
// that is where each one is put down to a holder:
//
//   · a web request: its route's pattern ("GET /reports/:key"), never its path,
//     so no id, slug or value is ever kept. A connection taken before the
//     request reached its route (a middleware's read) is added to the route's
//     total when the request ends.
//   · background work: the name it runs under (as(name, fn)): "job <name>" for
//     a queued job (jobQueue.runOne), "tick <name>" for a timer (bootGate's
//     ticks, the per-boot jobs). Anything else is "other background work".
//
// Per holder this keeps connection-milliseconds held, the most connections it
// held at once, and how many it took. capacity.js writes the top holders with
// each five-minute sample (capacity_holders), and /ops reads the last 24 hours.
// Names and counts only: no org, no person, no value.
"use strict";
const { AsyncLocalStorage } = require("async_hooks");

const labels = new AsyncLocalStorage();
const OTHER = "other background work";
const KEEP_PER_SAMPLE = 25;   // the most holders one process writes per sample
const TOP = 8;                // what the card shows

// Run fn as `name`'s work: every connection it (and what it starts) takes is
// put down to `name`.
function as(name, fn) { return labels.run({ name: String(name) }, fn); }
const label = () => { const s = labels.getStore(); return s ? s.name : null; };

// A request's holder: its method and route pattern, once routing has found it.
function routeName(req) {
  if (!req || !req.route) return null;
  const p = req.route.path;
  return `${req.method} ${req.baseUrl || ""}${typeof p === "string" ? p : String(p)}`;
}
// The holder for a connection taken now, in request scope `sc` (or none).
function nameNow(sc) {
  if (sc && sc.req) return routeName(sc.req);   // null until routing has found the route
  return label() || (sc ? "shared work" : OTHER);
}

let acc = new Map();          // name -> { ms, peak, uses }
const live = new Map();       // name -> connections held now
const slot = (name) => { let a = acc.get(name); if (!a) acc.set(name, a = { ms: 0, peak: live.get(name) || 0, uses: 0 }); return a; };

// A connection was handed out (after requestLimits has aligned it).
function took(client, sc) {
  const name = nameNow(sc);
  client.__holder = name || null;
  client.__holderScope = name ? null : sc;   // named when its request ends (settle)
  client.__holderAt = Date.now();
  if (!name) return;
  const n = (live.get(name) || 0) + 1;
  live.set(name, n);
  const a = slot(name);
  a.uses++;
  if (n > a.peak) a.peak = n;
}
// The connection went back.
function gave(client) {
  if (!client.__holderAt) return;
  const ms = Date.now() - client.__holderAt;
  const name = client.__holder, sc = client.__holderScope;
  client.__holderAt = 0; client.__holder = null; client.__holderScope = null;
  if (name) {
    live.set(name, Math.max(0, (live.get(name) || 1) - 1));
    slot(name).ms += ms;
    return;
  }
  // Taken before the route was known: named now if it is, else when the request ends.
  const now = sc && routeName(sc.req);
  if (now) { const a = slot(now); a.ms += ms; a.uses++; return; }
  if (sc) { sc.holderPendingMs = (sc.holderPendingMs || 0) + ms; sc.holderPendingUses = (sc.holderPendingUses || 0) + 1; }
}
// A request ended: what it held before its route was known goes to its route
// (or to "<METHOD> (no route)" when none matched).
function settle(sc) {
  if (!sc || !sc.holderPendingMs && !sc.holderPendingUses) return;
  const name = routeName(sc.req) || `${sc.req ? sc.req.method : "?"} (no route)`;
  const a = slot(name);
  a.ms += sc.holderPendingMs || 0; a.uses += sc.holderPendingUses || 0;
  sc.holderPendingMs = 0; sc.holderPendingUses = 0;
}

// What this process held since the last take(), most first; resets the window.
// A holder still holding keeps its live count as the next window's floor.
function take() {
  const out = [...acc.entries()].map(([holder, a]) => ({ holder, ms: Math.round(a.ms), peak: a.peak, uses: a.uses }))
    .filter(r => r.ms > 0 || r.peak > 0)
    .sort((x, y) => y.ms - x.ms || y.peak - x.peak || x.holder.localeCompare(y.holder));
  acc = new Map();
  return out;
}
const peekAll = () => [...acc.entries()].map(([holder, a]) => ({ holder, ms: Math.round(a.ms), peak: a.peak, uses: a.uses }));

async function ensureTable(run) {
  for (let i = 0; i < 3; i++) {
    try {
      await run(`DO $$ BEGIN SET LOCAL lock_timeout = '5s';
        CREATE TABLE IF NOT EXISTS capacity_holders (
          at TIMESTAMPTZ NOT NULL DEFAULT NOW(), process TEXT NOT NULL, role TEXT NOT NULL,
          holder TEXT NOT NULL, held_ms BIGINT NOT NULL, peak INTEGER NOT NULL, uses INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_capacity_holders_at ON capacity_holders (at); END $$`, []);
      return true;
    } catch (e) { if (i === 2) { console.error("[capacity] holders table", e.message); return false; } await new Promise(r => setTimeout(r, 1000 * (i + 1))); }
  }
}

// One sample's holders, written beside capacity_samples (capacity.js flush).
async function flush(run, processName, role, keepDays) {
  const rows = take().slice(0, KEEP_PER_SAMPLE);
  for (const r of rows) {
    await run(`INSERT INTO capacity_holders (process, role, holder, held_ms, peak, uses) VALUES (?, ?, ?, ?, ?, ?)`,
      [processName, role, r.holder.slice(0, 200), r.ms, r.peak, r.uses]);
  }
  await run(`DELETE FROM capacity_holders WHERE at < NOW() - (? * INTERVAL '1 day')`, [keepDays]);
  return rows.length;
}

// The card's list: the last 24 hours, every process together, top 8 by time held.
function summarize(rows) {
  const by = new Map();
  for (const r of rows) {
    const b = by.get(r.holder) || { holder: r.holder, ms: 0, peak: 0, uses: 0, roles: new Set() };
    b.ms += Number(r.held_ms ?? r.ms) || 0; b.uses += Number(r.uses) || 0;
    b.peak = Math.max(b.peak, Number(r.peak) || 0); if (r.role) b.roles.add(r.role);
    by.set(r.holder, b);
  }
  const all = [...by.values()];
  const total = all.reduce((s, b) => s + b.ms, 0);
  const top = all.sort((x, y) => y.ms - x.ms || y.peak - x.peak || x.holder.localeCompare(y.holder)).slice(0, TOP)
    .map(b => ({ holder: b.holder, seconds: Math.round(b.ms / 100) / 10, sharePct: total ? Math.round(b.ms / total * 1000) / 10 : 0,
      peak: b.peak, uses: b.uses, where: [...b.roles].sort().join(", ") }));
  return { top, totalSeconds: Math.round(total / 100) / 10, holders: all.length,
    definition: "Connection-seconds: how long each holder kept database connections, added across every process. Most at once is the most it held at the same moment in one process. A request is named by its route, background work by its job or tick." };
}
async function read(query) {
  try {
    const rows = await query(`SELECT holder, role, SUM(held_ms)::bigint AS held_ms, MAX(peak)::int AS peak, SUM(uses)::bigint AS uses
                                FROM capacity_holders WHERE at > NOW() - INTERVAL '24 hours' GROUP BY holder, role`, []);
    return summarize(rows);
  } catch (_) { return summarize([]); }
}

module.exports = { as, label, took, gave, settle, take, peekAll, flush, ensureTable, summarize, read, routeName, TOP, OTHER };
