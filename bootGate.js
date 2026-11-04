// FIX-51 · MIGRATIONS FINISH BEFORE ANY BOOT JOB RUNS.
//
// On a fresh database the workflow-to-journey conversion ran four seconds
// after listen, while initSchema was still creating tables, and logged
// `relation "workflow_conversions" does not exist`. Every job a module starts
// on a timer at boot goes through afterMigrations: its delay starts only once
// server.js has said the schema is in (markReady, the same moment as
// DB_READY). No requires, so any module can load it.
//
// DEPLOY-1 · READY MEANS EVERY ROUTE CAN ANSWER. The prod AI smoke got HTTP 500
// from Ask right after two deploys. /ready (Railway's healthcheck) and the
// request gate opened once the database was up, while the rest of the boot
// (the legacy custom-field step, the shared modules routes bind on import, the
// AI client, the Ask modules, a warm pool) was still on its way. Now each of
// those is a `need`, and the gate stays shut (503, never a 500) until every
// need has resolved. On SIGTERM `drain()` turns /ready back to 503 so the
// router stops sending this process new work while it finishes what it has.
"use strict";

let markReady = null;
const READY = new Promise(resolve => { markReady = resolve; });

// fn after `ms`, counted from the end of the migrations. Returns nothing: a
// boot job is fire-and-forget, and its own .catch says what went wrong.
function afterMigrations(fn, ms = 0, { unref = false } = {}) {
  READY.then(() => { const t = setTimeout(fn, ms); if (unref && t.unref) t.unref(); });
}
// The same for a repeating job: the first tick is `everyMs` after the migrations.
function everyAfterMigrations(fn, everyMs, { unref = false } = {}) {
  READY.then(() => { const t = setInterval(fn, everyMs); if (unref && t.unref) t.unref(); });
}

// name -> { done, error }. A need that fails keeps the gate shut and says so
// on /ready: a process that cannot serve a route must not be sent traffic.
const needs = new Map();
function need(name, promise) {
  const n = needs.get(name) || { done: false, error: null, retrying: null };
  needs.set(name, n);
  Promise.resolve(promise).then(() => { n.done = true; n.retrying = null; }, e => {
    n.error = String(e && e.message || e).slice(0, 200);
    console.error(`[boot] CRITICAL: ${name} did not get ready:`, n.error);
  });
}
// POOL-1: a need still trying says why on /ready, in a word from a fixed
// list (never an error's text, which may carry a host). null when it is not.
function retrying(name, why) {
  const n = needs.get(name) || { done: false, error: null, retrying: null };
  needs.set(name, n);
  n.retrying = why || null;
}
let draining = false;
const drain = () => { draining = true; };
const isDraining = () => draining;
// Every need resolved (the database among them).
const servable = () => needs.has("database") && [...needs.values()].every(n => n.done);
// What /ready says it is waiting for: names only, never a value.
function waitingFor() {
  return [...needs.entries()].filter(([, n]) => !n.done)
    .map(([k, n]) => (n.error ? `${k} (failed)` : n.retrying ? `${k} (retrying: ${n.retrying})` : k));
}

module.exports = { READY, markReady: () => markReady(), afterMigrations, everyAfterMigrations,
  need, retrying, servable, waitingFor, drain, isDraining };
