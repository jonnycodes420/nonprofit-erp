// DEPLOY-1 · A DEPLOY DROPS NO REQUEST AND LOSES NO JOB.
//
// Before DEPLOY-1 nothing in the process listened for SIGTERM, so Node's
// default ended it on the spot: a request in flight on the old container lost
// its answer, and a job the old worker held stayed `running` until the reaper
// gave it back ten minutes later. Now, on SIGTERM (Railway stops a deployment
// with it) or SIGINT:
//
//   1. /ready answers 503 (bootGate.drain), so the router sends nothing new;
//   2. the listening socket closes; a request already on a kept-alive
//      connection is still served, with `Connection: close`;
//   3. requests in flight finish, for up to SHUTDOWN_GRACE_MS (25 s);
//   4. a process that runs jobs claims no more, lets its running jobs finish
//      inside the same window, and hands back the rest (jobQueue.stop), so the
//      next worker runs each of them, once;
//   5. it exits 0. A second signal, or the end of the window, ends it anyway.
"use strict";
const bootGate = require("../../bootGate");

const GRACE_MS = () => Math.max(1000, Number(process.env.SHUTDOWN_GRACE_MS) || 25000);

function install(server, { jobs = null, log = console } = {}) {
  let inFlight = 0, stopping = false;
  server.on("request", (req, res) => {
    inFlight++;
    if (stopping) res.setHeader("Connection", "close");
    res.on("close", () => { inFlight--; });
  });

  async function shutdown(signal) {
    if (stopping) { log.error(`[shutdown] ${signal} again: exiting now`); process.exit(1); }
    stopping = true;
    const started = performance.now();
    const left = () => Math.max(0, GRACE_MS() - (performance.now() - started));
    log.log(`[shutdown] ${signal}: no new work; finishing ${inFlight} request(s)${jobs && jobs.holding() ? ` and ${jobs.holding()} job(s)` : ""}`);
    bootGate.drain();
    server.close();
    // Kept-alive sockets with nothing in flight would hold close() open.
    const idle = setInterval(() => server.closeIdleConnections(), 250);
    if (idle.unref) idle.unref();
    // The jobs get the window less a moment, so handing back still fits in it.
    const jobsDone = jobs ? jobs.stop({ graceMs: Math.max(0, left() - 1500) }).catch(e => { log.error("[shutdown] jobs:", e.message); return {}; }) : Promise.resolve({});
    while (inFlight > 0 && left() > 0) await new Promise(r => setTimeout(r, 50));
    const out = await jobsDone;
    clearInterval(idle);
    const dropped = inFlight;
    if (dropped) server.closeAllConnections();
    log.log(`[shutdown] done in ${Math.round(performance.now() - started)} ms`
      + `${dropped ? `; ${dropped} request(s) still open at the end of the window were closed` : ""}`
      + `${out && out.handedBack ? `; ${out.handedBack} job(s) handed back` : ""}`);
    process.exit(0);
  }
  process.once("SIGTERM", () => { shutdown("SIGTERM"); process.on("SIGTERM", () => shutdown("SIGTERM")); });
  process.once("SIGINT", () => { shutdown("SIGINT"); process.on("SIGINT", () => shutdown("SIGINT")); });
  return { shutdown, inFlight: () => inFlight };
}

// POOL-1 · BOOT NEVER GIVES UP ON THE POOL. On 3 Nov the new web's "pool"
// need (four SELECT 1 at once) met a full pooler during the deploy overlap
// (EMAXCONNSESSION), rejected once and never tried again: /ready said 503 for
// 9.5 minutes and Railway failed the deploy, though the old web had given its
// connections back long before. Now the need opens ONE connection, and on any
// error tries again after 1 s, 2 s, 4 s ... (at most 10 s apart) until it
// gets one, logging each try once and saying on /ready what it waits for. The
// database need waits on it, so a boot that meets a full pooler waits instead
// of exiting. It is never given up: a process that cannot reach its database
// is not sent traffic either way, and one that waits turns ready the moment a
// connection frees.
const RETRY_WORD = (e) => (require("../../db").isPoolFull(e) ? "max clients reached"
  : e && e.code === "ECONNREFUSED" ? "connection refused" : "connection error");
const backoff = (tryNo) => Math.min(10000, 1000 * 2 ** (tryNo - 1));
let firstConnection = null;
function poolReady({ log = console, sleep = (ms) => new Promise(r => setTimeout(r, ms)) } = {}) {
  if (firstConnection) return firstConnection;
  const db = require("../../db");
  bootGate.need("pool", firstConnection = (async () => {
    for (let tryNo = 1; ; tryNo++) {
      try {
        await db.query("SELECT 1");
        if (tryNo > 1) log.log(`[boot] pool: connected on try ${tryNo}`);
        return;
      } catch (e) {
        const why = RETRY_WORD(e);
        bootGate.retrying("pool", why);
        log.error(`[boot] pool: try ${tryNo} failed (${why}); next in ${backoff(tryNo) / 1000} s`);
        await sleep(backoff(tryNo));
      }
    }
  })());
  return firstConnection;
}

// The boot needs that live outside server.js's own chain (bootGate.js): the
// pool (above, started by the database need); the AI client; and, in
// TEST_MODE only, a slow step on demand, with which
// tests/deploy1-ready.test.js proves the gate holds every route behind every
// need, not the database alone.
function bootNeeds({ testMode }) {
  poolReady();
  bootGate.need("ai", require("../../aiClient").warm());
  const slow = Number(process.env.STEWARD_TEST_SLOW_BOOT_MS);
  if (testMode() && slow > 0) bootGate.need("test-slow-step", new Promise(r => setTimeout(r, slow)));
}

module.exports = { install, bootNeeds, poolReady, backoff, GRACE_MS };
