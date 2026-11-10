// LOAD-1 · NO REQUEST CAN HOLD THE SITE. Every web request runs inside a
// scope (an AsyncLocalStorage store, opened by middleware() at the top of the
// app), and every connection db.js hands out inside that scope carries the
// scope's statement_timeout. On 4 Nov a fresh org's Donors list took 146 s;
// each refresh left another one running, and /me, /privacy and /home/bundle
// for every org waited 6 to 23 s behind them for the web's ten connections.
//
//   · A statement stops at the scope's limit: 10 s, or a named longer one for
//     the few routes whose single statements are big by nature (LONGER below).
//     The answer is a 503 with one plain sentence, never a hang.
//   · A wait for a connection stops at the same limit, with the same answer,
//     and is counted (stats().checkoutTimeouts, on /health.pool).
//   · A read the browser abandons (a refresh, a closed tab, a navigation) has
//     its running statement cancelled (pg_cancel_backend on a one-connection
//     side pool), and nothing it would have run next is started. A write is
//     never cancelled half way; its statements still stop at the limit.
//   · Work a request starts and does not wait for (an after-change pass) is
//     background once the response has gone: no limit, never cancelled.
// Outside a scope (boot, the worker, the queue's lanes) nothing changes.
"use strict";
const { AsyncLocalStorage } = require("async_hooks");

const DEFAULT_MS = Math.max(1000, Number(process.env.REQUEST_STATEMENT_TIMEOUT_MS) || 10000);
// The named longer limits, and the routes that take them. A limit is per
// statement, so a route that runs many quick statements (a PDF, a page of
// reports) needs none of these; only one statement that reads or writes a
// whole org at once does.
const NAMED = Object.freeze({ default: DEFAULT_MS, report: 30000, export: 120000, bulk: 120000 });
const LONGER = [
  // A whole org's records, written out (Settings → Export, a figure's rows, one person's file).
  [/^\/(org\/export|donors\/export\/|figures\/[^/]+\/export\.csv$|donors\/[^/]+\/export-data$)/, "export"],
  // (INSIGHTS-2: /groups/starters left this list; its counts are one pass, server/groups/starterCounts.js.)
  // A spreadsheet in, or a big set changed at once (import, undo, merge, bulk edit, recompute).
  [/^\/(donors\/import|gifts\/import|grants\/import|history-import\/|sheet-import\/|imports(\/|$)|deposits\/commit|setup\/runs|admin\/orgs\/[^/]+\/setup|data-health\/(bulk-|merge)|donors\/(bulk-|merge)|import-merges|scores\/recompute|journeys\/batches\/|old-reports\/batches\/|photos\/bulk|finance\/imported-deposited)/, "bulk"],
];
const limitFor = (path) => { for (const [re, name] of LONGER) if (re.test(path)) return name; return "default"; };

const TOO_LONG = "This took too long; try again or narrow it.";
const tooLong = () => Object.assign(new Error(TOO_LONG), { code: "request_timeout", status: 503 });
const abandoned = () => Object.assign(new Error("The request was closed before it finished."), { code: "request_abandoned", status: 499 });
// 57014 is query_canceled: both a statement_timeout and a pg_cancel_backend.
const isCancel = (e) => !!e && e.code === "57014";

const scopes = new AsyncLocalStorage();
const counters = { checkoutTimeouts: 0, statementTimeouts: 0, cancelled: 0 };

// The scope a query is running in, while its request is still being answered.
function live() { const sc = scopes.getStore(); return sc && !sc.done ? sc : null; }

let _cancelPool = null;
function cancelPool(Pool, options) {
  // One connection, opened only when a read is abandoned and closed after 10 s
  // idle, so the budget (ARCHITECTURE.md) gains at most one, briefly.
  return _cancelPool || (_cancelPool = new Pool({ ...options, max: 1, idleTimeoutMillis: 10000, allowExitOnIdle: true })
    .on("error", err => console.error("[db] cancel connection dropped:", err.message)));
}

// The scope's close: cancel what is running, refuse what is waiting.
function close(sc, cancelBackend) {
  if (sc.closed) return;
  sc.closed = true;
  for (const reject of sc.waiting) reject(abandoned());
  sc.waiting.clear();
  const pids = [...sc.held].map(c => c.__stewardPid).filter(Boolean);
  if (!pids.length) return;
  counters.cancelled += pids.length;
  // A held client is released only after its cancel has landed, so the signal
  // can never reach the next request's statement on the same backend.
  sc.cancelling = cancelBackend(pids).catch(err => console.error("[db] cancel failed:", err.message));
}

// Express middleware: open the scope for this request. db.js passes in how a
// backend is cancelled.
function middleware(cancelBackend) {
  return (req, res, next) => {
    // A route called inside the process (a bundle's reads) is part of the
    // request that called it, and keeps that request's scope as it is.
    if (req.__stewardInProcess) return next();
    const name = limitFor(req.path);
    const sc = { limitMs: NAMED[name], limitName: name, read: req.method === "GET" || req.method === "HEAD",
      closed: false, done: false, timedOut: false, held: new Set(), waiting: new Set(), cancelling: null };
    res.on("finish", () => { sc.done = true; });
    res.on("close", () => { if (!res.writableFinished && sc.read) close(sc, cancelBackend); sc.done = true; });
    // A route that caught the timeout itself and answered 500 with its message
    // still answers 503: the sentence is the same, and the status says "again".
    const json = res.json.bind(res);
    res.json = (body) => { if (sc.timedOut && res.statusCode >= 500) res.status(503); return json(body); };
    scopes.run(sc, next);
  };
}

// A connection from `pool` for the current scope (or none): waits at most the
// scope's limit, carries the scope's statement_timeout, and is tracked so an
// abandon can cancel it. release(client) must be called for every one.
async function checkout(pool) {
  const sc = live();
  if (!sc) return align(await pool.connect(), 0, null);
  if (sc.closed) throw abandoned();
  const t0 = Date.now();   // SCALE-3: the wait, for the capacity gauge (server/perf/capacity.js)
  const client = await new Promise((resolve, reject) => {
    // One wait: it ends once, by a connection, the limit, or an abandon (close()).
    const wait = { settled: false, timer: null, fail: null };
    const end = () => { wait.settled = true; clearTimeout(wait.timer); sc.waiting.delete(wait.fail); };
    wait.fail = (e) => { if (!wait.settled) { end(); reject(e); } };
    wait.timer = setTimeout(() => { counters.checkoutTimeouts++; sc.timedOut = true; wait.fail(tooLong()); }, sc.limitMs);
    sc.waiting.add(wait.fail);
    pool.connect().then(c => {
      if (wait.settled) return c.release();
      end(); resolve(c);
    }, wait.fail);
  });
  require("../perf/capacity").noteWait(Date.now() - t0);
  return align(client, sc.limitMs, sc);
}
async function align(client, ms, sc) {
  try {
    const needPid = sc && !client.__stewardPid;
    if ((client.__stewardLimit || 0) !== ms || needPid) {
      const r = await client.query(`SET statement_timeout = ${Number(ms) | 0}${needPid ? "; SELECT pg_backend_pid() AS pid" : ""}`);
      if (needPid) client.__stewardPid = r[1].rows[0].pid;
      client.__stewardLimit = ms;
    }
  } catch (e) { client.release(e); throw e; }
  if (sc) { sc.held.add(client); client.__stewardScope = sc; }
  return client;
}
function release(client, err) {
  const sc = client.__stewardScope;
  client.__stewardScope = null;
  if (!sc) return client.release(err);
  sc.held.delete(client);
  if (sc.cancelling) return void sc.cancelling.then(() => client.release(err));
  client.release(err);
}
// What a query's error becomes: a statement timeout is the plain sentence.
function translate(e) {
  const sc = scopes.getStore();
  if (!isCancel(e) || !sc) return e;
  if (sc.closed) return abandoned();
  sc.timedOut = true; counters.statementTimeouts++;
  return tooLong();
}
// A held client's next statement after an abandon is never started.
function guard() { const sc = live(); if (sc && sc.closed) throw abandoned(); }

// Work several requests wait on together (one org's Insights): it keeps the
// default limit but is no one request's, so one caller's abandon never
// cancels it for the others.
function shared(fn) {
  if (!scopes.getStore()) return fn();
  const sc = { limitMs: DEFAULT_MS, limitName: "default", read: false, closed: false, done: false, timedOut: false,
    held: new Set(), waiting: new Set(), cancelling: null };
  return scopes.run(sc, fn);
}

// A route that needs a named longer limit from here on (LONGER covers most).
function useLimit(name) {
  if (!NAMED[name]) throw new Error(`requestLimits: no limit named ${name}`);
  return (req, res, next) => { const sc = live(); if (sc) { sc.limitMs = NAMED[name]; sc.limitName = name; } next(); };
}

// The app's error handler asks here first: a statement or a wait past its
// limit is a 503 with the plain sentence; an abandoned read has nobody to answer.
function answerError(err, req, res, route) {
  if (err && err.code === "request_timeout") {
    console.warn(`[503] ${req.method} ${route} rid=${req.id || "-"} too long`);
    res.status(503).json({ error: err.message, code: err.code });
    return true;
  }
  if (err && err.code === "request_abandoned") { if (!res.headersSent && !res.destroyed) res.status(499).end(); return true; }
  return false;
}

// db.js's cancel: pg_cancel_backend for each pid, on the side pool.
function cancelWith(Pool, options) {
  return (pids) => cancelPool(Pool, options).query("SELECT pg_cancel_backend(p) FROM unnest($1::int[]) p", [pids]);
}

module.exports = { answerError, cancelWith, DEFAULT_MS, NAMED, LONGER, limitFor, TOO_LONG, middleware, checkout, release, translate, guard, useLimit, shared,
  cancelPool, live, stats: () => ({ ...counters }), isCancel };
