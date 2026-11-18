// server/jobs/wake.js · SCALE-5. A NEW JOB WAKES THE WORKER AT ONCE.
//
// The worker's lanes used to ask the queue every second, four of them, each a
// three-statement transaction, all day: with SCALE-4's sampler on, the queue's
// own bookkeeping held 25% of prod's connection time. Now an empty queue is
// asked by one lane, less and less often (jobQueue.js), and a row that becomes
// runnable says so: a trigger on job_queue sends NOTIFY steward_jobs on every
// insert and on every row put back to waiting, in the writer's transaction, so
// the notice arrives as it commits. The worker LISTENs on one connection of
// its own (outside the pool, so it never takes a lane's place; the connection
// budget counts it, server/perf/connectionBudget.js).
//
// If the listening connection drops, the lanes still poll (at most every
// JOB_POLL_MAX_MS), and the listener reconnects with a backoff.
//
// OFF BY DEFAULT (JOB_WAKE=on to use it). Measured on the ten-orgs load profile
// (SCALE-5 report): with the trigger on, a gift's POST p95 was 671 ms against
// 495 ms off, and slower than main in each paired run, while /donors did not
// move. The gift path is what a person waits on, so the worker polls instead
// (one lane, backing off to JOB_POLL_MAX_MS, 2 s), and an enqueue in the
// worker's own process still wakes it at once. Turn it on only with a load run
// that shows the gift path unchanged.
const wakeOn = () => String(process.env.JOB_WAKE || "").toLowerCase() === "on";
"use strict";

const CHANNEL = "steward_jobs";
const LOCK_TIMEOUT = "1s";

// The trigger (additive; built at boot with lock_timeout and a retry).
async function ensureWakeTrigger(pool) {
  const client = await pool.connect();
  try {
    await client.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
    const tries = async (sql) => {
      for (let i = 1; ; i++) {
        try { return await client.query(sql); }
        catch (e) { if (e.code !== "55P03" || i >= 20) throw e; await new Promise(r => setTimeout(r, Math.min(3000, 200 * i))); }
      }
    };
    await tries(`CREATE OR REPLACE FUNCTION steward_jobs_wake() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_notify('${CHANNEL}', ''); RETURN NULL; END $$`);
    // Not on: no notices at all (the lanes poll); a trigger left by an earlier boot goes.
    if (!wakeOn()) {
      for (const name of ["job_queue_wake_ins", "job_queue_wake_back"]) await tries(`DROP TRIGGER IF EXISTS ${name} ON job_queue`);
      return;
    }
    const have = new Set((await client.query(`SELECT tgname FROM pg_trigger WHERE tgrelid = 'job_queue'::regclass AND NOT tgisinternal`)).rows.map(r => r.tgname));
    const want = [
      ["job_queue_wake_ins", `AFTER INSERT ON job_queue FOR EACH STATEMENT EXECUTE FUNCTION steward_jobs_wake()`],
      ["job_queue_wake_back", `AFTER UPDATE OF status ON job_queue FOR EACH ROW WHEN (NEW.status = 'waiting' AND OLD.status IS DISTINCT FROM 'waiting') EXECUTE FUNCTION steward_jobs_wake()`],
    ];
    for (const [name, body] of want) {
      if (have.has(name)) continue;
      try { await tries(`CREATE TRIGGER ${name} ${body}`); }
      catch (e) { if (e.code !== "42710") throw e; }   // another boot made it meanwhile
    }
  } finally {
    await client.query("RESET lock_timeout").catch(() => {});
    client.release();
  }
}

// Listen until stop(). `onWake` is called for every notice (cheap: it pokes the lanes).
function listen(onWake, { log = console } = {}) {
  const { Client } = require("pg");
  const { pool } = require("../db/pool");
  let client = null, stopped = false, delay = 1000, timer = null;
  const state = { listening: false };
  const again = () => {
    if (stopped) return;
    timer = setTimeout(connect, delay); if (timer.unref) timer.unref();
    delay = Math.min(60000, delay * 2);
  };
  async function connect() {
    if (stopped) return;
    let c;
    try { c = new Client({ ...pool.options }); }
    catch (e) { log.error(`[jobs] wake listener: ${e.message}`); return again(); }
    client = c;
    c.on("error", (e) => { state.listening = false; log.error(`[jobs] wake listener: ${e.message}`); c.end().catch(() => {}); if (client === c) { client = null; again(); } });
    c.on("notification", (n) => { if (n.channel === CHANNEL) onWake(); });
    try {
      await c.connect();
      await c.query(`LISTEN ${CHANNEL}`);
      state.listening = true; delay = 1000;
      onWake();   // anything enqueued while nobody listened
    } catch (e) {
      state.listening = false;
      log.error(`[jobs] wake listener could not start: ${e.message}`);
      c.end().catch(() => {});
      if (client === c) { client = null; again(); }
    }
  }
  connect();
  return {
    state,
    stop: async () => { stopped = true; clearTimeout(timer); state.listening = false; if (client) await client.end().catch(() => {}); client = null; },
  };
}

module.exports = { ensureWakeTrigger, listen, CHANNEL, wakeOn };
