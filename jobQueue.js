// jobQueue.js — SCALE-1. THE BACKGROUND WORK RUNS FROM ONE QUEUE IN POSTGRES.
//
// Before SCALE-1 every background job was a setInterval inside the web
// process, so a second web replica would have run every job twice, and one
// slow mailbox held up the whole five-minute pass. Now:
//
//   job_schedule  one row per periodic job: when it is next due. A process
//                 enqueues a due job by moving next_run_at forward in ONE
//                 UPDATE, so however many processes run the scheduler, each
//                 due run is enqueued once.
//   job_queue     one row per run of a job. A worker claims a row with
//                 FOR UPDATE SKIP LOCKED, so two workers never take the same
//                 row, and never takes a row whose key is already running, so
//                 the same job never runs twice at once for the same org.
//
// Why a table and not pg-boss: the jobs already live in this codebase's own
// tables and audit seam (recordTick), the schema belongs in initSchema with
// every other table, and the whole mechanism is two statements. pg-boss would
// bring its own schema, its own migrations and its own maintenance loop for
// the same two statements.
//
// Who runs what, from STEWARD_PROCESS:
//   unset   the single process does everything, exactly as before SCALE-1
//   web     serves requests, enqueues, runs no jobs
//   worker  runs the scheduler and the jobs (and still answers /health)
//
// A job that throws is tried again after a backoff, five times in all, and
// then stops as `dead`: it is listed on the Admin console with its org and its
// error, and can be retried from there.
//
// DEPLOY-1 · NOTHING WAITS FOREVER. Prod's /health showed 9 jobs waiting and 8
// running, the oldest waiting 15 days. A row goes back to waiting when it fails
// or its worker dies, and the unique index `job_queue_one_waiting` allows one
// waiting row per key: when the same key had been enqueued again meanwhile,
// that UPDATE broke the index. finish() lost its write (the row stayed running
// with nobody beating it), and reapStale() was ONE statement over every stale
// row, so one such row failed the whole statement on every pass, silently. No
// running row was ever given back again, and each held its key's waiting row
// behind it. Now a row with a waiting twin is closed into it (the twin is the
// same run), every stale row is given back on its own, a running row whose
// lease is past its timeout is given back too, a waiting row no process can
// run is stopped with its reason, and a claim looks past any number of busy
// orgs and keys. On SIGTERM a worker stops claiming and hands back what it
// still holds (stop()).
const os = require("os");
const { query, run, uuid, withTransaction } = require("./db");

const MAX_ATTEMPTS = 5;
const ORG_CAP = () => Math.max(1, Number(process.env.JOB_ORG_CAP) || 2);
const CONCURRENCY = () => Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 4);
const POLL_MS = () => Math.max(50, Number(process.env.JOB_POLL_MS) || 1000);
// A running row whose worker has not touched it in this long is taken to have
// died with its process, and goes back to waiting (it counts as a try).
const STALE_MS = () => Math.max(1000, Number(process.env.JOB_STALE_MS) || 10 * 60 * 1000);
// DEPLOY-1: a run's lease. A handler still going after this long (default an
// hour; handle(name, fn, { timeoutMs }) for one that needs more) counts as a
// failed try, so a run that hangs with its heartbeat still beating cannot hold
// its key for ever.
const TIMEOUT_MS = () => Math.max(1000, Number(process.env.JOB_TIMEOUT_MS) || 60 * 60 * 1000);
// A waiting row whose name no running worker handles is stopped after this
// long. Not at once: during a deploy the old worker is still claiming, and a
// job type only the new code knows is not the old one's to stop.
const NO_HANDLER_MS = () => Math.max(0, Number(process.env.JOB_NO_HANDLER_MS ?? 15 * 60 * 1000));
const CLAIM_TRIES = 200;
// How often a process that runs jobs gives back stale rows and stops
// unrunnable ones (a minute; a test sets it shorter without shortening STALE_MS).
const REAP_MS = () => Math.max(100, Number(process.env.JOB_REAP_MS) || Math.min(60000, STALE_MS()));
const WORKER_ID = `${os.hostname()}:${process.pid}`;
let claimSeq = 0;

const schedules = new Map();   // name -> { everyMs, firstMs, run }
const handlers = new Map();    // name -> async (payload, job) => result
const timeouts = new Map();    // name -> ms, for a handler that needs a longer lease
const timeoutOf = (name) => timeouts.get(name) || TIMEOUT_MS();

// JOBS-1: WORKER=off on the web service says the same as STEWARD_PROCESS=web
// (the worker service runs `node worker.js`).
function role() {
  const r = String(process.env.STEWARD_PROCESS || "").trim().toLowerCase();
  if (r === "web" || r === "worker") return r;
  return String(process.env.WORKER || "").trim().toLowerCase() === "off" ? "web" : "both";
}
const runsJobs = () => role() !== "web";

// A periodic job. `run` is what the old setInterval called.
// `perBoot`: the job keeps its answer in this process's memory (the /health
// guards), so it runs IN THIS PROCESS, `firstMs` after it starts and every
// `everyMs` after that, on its own timer, whatever STEWARD_PROCESS says. It
// never goes through the queue: a queued run goes to whichever process claims
// it, and its answer then sits in that process's memory, not the one answering
// /health (the draining old container, a worker, or nobody for minutes behind a
// deploy's backlog; with STEWARD_PROCESS=web, nobody ever). FIX-47 moved the
// queued slot to each boot; GUARDS-1 takes it off the queue. Each web replica
// then makes its own read-only calls, which is the price of a true answer.
function define(name, { everyMs, firstMs = null, perBoot = false, run: fn }) {
  schedules.set(name, { everyMs, firstMs: firstMs == null ? everyMs : firstMs, perBoot, local: false, run: fn });
  // A per-boot run a previous deploy queued still has a handler, so it drains
  // once (read-only) instead of waiting forever.
  handlers.set(name, () => fn());
}
// Start every per-boot job's own timer in this process (once each). A run that
// is still going when the next is due is skipped, never doubled.
function startLocal() {
  for (const [name, s] of schedules) {
    if (!s.perBoot || s.local) continue;
    s.local = true;
    let busyNow = false;
    const go = async () => {
      if (busyNow) return;
      busyNow = true;
      try { await s.run(); } catch (e) { console.error(`[jobs] ${name}:`, e.message); } finally { busyNow = false; }
    };
    const t = setTimeout(() => { go(); const i = setInterval(go, s.everyMs); if (i.unref) i.unref(); }, s.firstMs);
    if (t.unref) t.unref();
  }
}
// A job that is only ever enqueued (one org's sync, an import's recent gifts).
function handle(name, fn, { timeoutMs = null } = {}) {
  handlers.set(name, fn);
  if (timeoutMs) timeouts.set(name, timeoutMs);
}

// Enqueue one run. At most one WAITING row per key: a second enqueue while one
// waits is the same run, so it is dropped. One already RUNNING does not stop a
// new waiting row, which is how "more work arrived while it ran" is not lost.
async function enqueue({ name, orgId = null, key = null, payload = null, runAfterMs = 0, round = null, priority = 5 }) {
  const id = "job_" + uuid().replace(/-/g, "").slice(0, 20);
  const k = key || (orgId ? `${name}:${orgId}` : name);
  const rows = await query(
    `INSERT INTO job_queue (id, name, org_id, key, payload, status, priority, run_after, round, created_by, created_by_name)
     VALUES (?,?,?,?,?::jsonb,'waiting',?, NOW() + (?::int * INTERVAL '1 millisecond'),?,?,?)
     ON CONFLICT (key) WHERE status = 'waiting' DO NOTHING RETURNING id`,
    [id, name, orgId, k, payload == null ? null : JSON.stringify(payload), priority, Math.max(0, runAfterMs | 0), round,
     "system:job-queue", "Steward (background work)"]);
  if (rows.length && runsJobs()) poke();
  return rows.length ? rows[0].id : null;
}

// Claim the next runnable row: one this process has a handler for (a process
// on older code never takes a job it cannot run), due, its key not already
// running, and its org under the per-org cap. DEPLOY-1: it looks past every
// busy org and key (it gave up after eight, so nine orgs at their cap held
// every other org's rows behind them). Each claim gets its own lease token in
// locked_by, so a run given back and claimed again by the same process is not
// finished by the first, late one.
//
// SKIP LOCKED means two workers racing for the same row do not wait on each
// other. The per-org cap and the one-run-per-key rule are checked AFTER an
// advisory lock on the org and on the key, in a fresh statement: checked in
// the same statement as the pick, four lanes claiming at once each saw "under
// the cap" in their own snapshot and one org took every lane (scale1-queue §4).
async function claim() {
  return withTransaction(async (c) => {
    const names = [...handlers.keys()], full = [], passed = [];
    for (let i = 0; i < CLAIM_TRIES; i++) {
      const cand = (await c.query(
        `SELECT j.id, j.org_id, j.key FROM job_queue j
          WHERE j.status = 'waiting' AND j.run_after <= NOW() AND j.name = ANY($1::text[])
            AND (j.org_id IS NULL OR NOT (j.org_id = ANY($2::text[]))) AND NOT (j.id = ANY($3::text[]))
            AND NOT EXISTS (SELECT 1 FROM job_queue r WHERE r.key = j.key AND r.status = 'running')
          ORDER BY j.priority, j.run_after, j.created_at
          LIMIT 1 FOR UPDATE SKIP LOCKED`, [names, full, passed])).rows[0];
      if (!cand) return null;
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["jobq-key:" + cand.key]);
      if ((await c.query(`SELECT 1 FROM job_queue WHERE key = $1 AND status = 'running' LIMIT 1`, [cand.key])).rows.length) {
        passed.push(cand.id); continue;   // the key started running a moment ago: try the next row
      }
      if (cand.org_id) {
        await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, ["jobq-org:" + cand.org_id]);
        const [{ n }] = (await c.query(`SELECT COUNT(*)::int AS n FROM job_queue WHERE org_id = $1 AND status = 'running'`, [cand.org_id])).rows;
        if (n >= ORG_CAP()) { full.push(cand.org_id); continue; }
      }
      const r = await c.query(
        `UPDATE job_queue SET status = 'running', attempts = attempts + 1, locked_by = $2, started_at = NOW(),
                heartbeat_at = NOW(), finished_at = NULL
          WHERE id = $1 RETURNING *`, [cand.id, `${WORKER_ID}#${++claimSeq}`]);
      return r.rows[0] || null;
    }
    return null;
  });
}

const BACKOFF_MS = () => Math.max(10, Number(process.env.JOB_BACKOFF_MS) || 30000);
// A row may carry its own base (backoff_ms); otherwise the process's.
const backoffMs = (attempts, base) => Math.min(30 * 60 * 1000, (Number(base) || BACKOFF_MS()) * 2 ** Math.max(0, attempts - 1));

// DEPLOY-1 · a running row goes back to waiting. When its key already has a
// waiting row (enqueued again while it ran), that row IS the next run, so this
// one is closed into it instead of breaking job_queue_one_waiting (23505), the
// write that used to fail and leave the row running for good. `lockedBy` null
// = whoever holds it (the reaper); `tryBack` = the run does not count as a try.
async function giveBack(id, lockedBy, { error, runAfterMs = 0, failed = true, tryBack = false }) {
  const msg = String(error || "").slice(0, 500);
  for (let i = 0; i < 2; i++) {
    try {
      const r = await query(
        `UPDATE job_queue j
            SET status = CASE WHEN EXISTS (SELECT 1 FROM job_queue w WHERE w.key = j.key AND w.status = 'waiting') THEN 'done' ELSE 'waiting' END,
                last_error = CASE WHEN EXISTS (SELECT 1 FROM job_queue w WHERE w.key = j.key AND w.status = 'waiting')
                                  THEN ? || ' · closed into the run already waiting for it' ELSE ? END,
                run_after = NOW() + (?::int * INTERVAL '1 millisecond'), locked_by = NULL,
                attempts = CASE WHEN ? THEN GREATEST(attempts - 1, 0) ELSE attempts END,
                finished_at = CASE WHEN EXISTS (SELECT 1 FROM job_queue w WHERE w.key = j.key AND w.status = 'waiting') THEN NOW() ELSE NULL END,
                failed_at = CASE WHEN ? THEN NOW() ELSE failed_at END
          WHERE j.id = ? AND j.status = 'running' AND (?::text IS NULL OR j.locked_by = ?)
          RETURNING j.status`, [msg, msg, Math.max(0, runAfterMs | 0), !!tryBack, !!failed, id, lockedBy, lockedBy]);
      return r[0] ? r[0].status : null;
    } catch (e) {
      // A waiting twin was inserted between the check and the write: once more
      // and it is seen.
      if (e.code !== "23505" || i) throw e;
    }
  }
  return null;
}

async function finish(job, err) {
  if (!err) {
    await run(`UPDATE job_queue SET status='done', finished_at=NOW(), last_error=NULL WHERE id=? AND locked_by=?`, [job.id, job.locked_by]);
    return;
  }
  const msg = String(err && err.message || err).slice(0, 500);
  const dead = job.attempts >= (job.max_attempts || MAX_ATTEMPTS);
  if (dead) {
    await run(
      `UPDATE job_queue SET status = 'dead', finished_at = NOW(), last_error = ?, failed_at = NOW()
        WHERE id = ? AND locked_by = ?`, [msg, job.id, job.locked_by]);
  } else {
    await giveBack(job.id, job.locked_by, { error: msg, runAfterMs: backoffMs(job.attempts, job.backoff_ms) });
  }
  console.error(`[jobs] ${job.name}${job.org_id ? " " + job.org_id : ""} failed (try ${job.attempts}): ${msg}${dead ? " · stopped" : ""}`);
}

const held = new Map();   // job id -> the job, while this process runs it
const BEAT_MS = () => Math.max(100, Math.min(30000, Math.floor(STALE_MS() / 4)));
async function runOne(job) {
  const fn = handlers.get(job.name);
  held.set(job.id, job);
  // Keep the row alive while it runs, so a long run is not mistaken for a
  // dead worker.
  const beat = setInterval(() => {
    run(`UPDATE job_queue SET heartbeat_at = NOW() WHERE id = ? AND locked_by = ?`, [job.id, job.locked_by]).catch(() => {});
  }, BEAT_MS());
  if (beat.unref) beat.unref();
  let timer = null;
  try {
    if (!fn) throw new Error(`No handler for job "${job.name}" in this process`);
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    // DEPLOY-1: past its lease the run is a failed try and the lane moves on;
    // the hung call is abandoned (its late finish matches no lease).
    const ms = timeoutOf(job.name);
    await Promise.race([
      fn(payload || {}, job),
      new Promise((_, no) => { timer = setTimeout(() => no(new Error(`ran longer than its ${Math.round(ms / 60000) || 1} minute lease`)), ms); if (timer.unref) timer.unref(); }),
    ]);
    await finish(job, null);
  } catch (e) {
    await finish(job, e).catch(x => console.error("[jobs] could not record a failure:", x.message));
  } finally { clearInterval(beat); clearTimeout(timer); held.delete(job.id); }
}

// ── The scheduler: enqueue each due periodic job, once across all processes.
async function scheduleDue() {
  for (const [name, s] of schedules) {
    if (s.perBoot) continue;   // runs on its own timer in each process (startLocal)
    await run(
      `INSERT INTO job_schedule (name, every_ms, next_run_at) VALUES (?, ?, NOW() + (?::int * INTERVAL '1 millisecond'))
       ON CONFLICT (name) DO UPDATE SET every_ms = EXCLUDED.every_ms`,
      [name, s.everyMs, s.firstMs]);
    const due = await query(
      `UPDATE job_schedule SET next_run_at = NOW() + (every_ms * INTERVAL '1 millisecond'), last_enqueued_at = NOW()
        WHERE name = ? AND next_run_at <= NOW() RETURNING name`, [name]);
    if (due.length) await enqueue({ name, key: name, round: `${name}@${Date.now()}` });
  }
}
// A worker that died mid-run leaves its row running. Give it back, ONE ROW AT
// A TIME (DEPLOY-1): a row that cannot be given back never holds up the rest.
// Stale: no heartbeat for STALE_MS (a row with none at all counts from its
// start), or still running past its lease plus STALE_MS (its own process gives
// it up at the lease; this is for one that cannot).
async function reapStale() {
  const rows = await query(
    `SELECT id, name, attempts, max_attempts,
            COALESCE(heartbeat_at, started_at, created_at) < NOW() - (?::int * INTERVAL '1 millisecond') AS silent,
            EXTRACT(EPOCH FROM NOW() - COALESCE(started_at, created_at)) * 1000 AS ran_ms
       FROM job_queue WHERE status = 'running'`, [STALE_MS()]);
  let n = 0;
  for (const r of rows) {
    const over = Number(r.ran_ms) > timeoutOf(r.name) + STALE_MS();
    if (!r.silent && !over) continue;
    const error = r.silent ? "The worker running this stopped before it finished." : "It ran past its lease and its worker did not give it up.";
    try {
      if (r.attempts >= (r.max_attempts || MAX_ATTEMPTS)) {
        await run(`UPDATE job_queue SET status = 'dead', locked_by = NULL, finished_at = NOW(), failed_at = NOW(), last_error = ?
                    WHERE id = ? AND status = 'running'`, [error, r.id]);
      } else await giveBack(r.id, null, { error });
      n++;
    } catch (e) { console.error(`[jobs] could not give back ${r.id}:`, e.message); }
  }
  return n;
}
// DEPLOY-1 · a waiting row that no running worker can run (its type was
// renamed or removed) is stopped with its reason, never left to wait. Only a
// process that runs jobs does this, and only past NO_HANDLER_MS (see above).
// The names come from this process and every worker seen in the last two
// minutes (process_heartbeats), so a type the newer code knows is never
// stopped by the older process.
async function failUnhandled() {
  const known = new Set(handlers.keys());
  try {
    const peers = await query(`SELECT handlers FROM process_heartbeats WHERE seen_at > NOW() - INTERVAL '2 minutes' AND stopped_at IS NULL`);
    for (const p of peers) for (const h of p.handlers || []) known.add(h);
  } catch (_) { /* no table yet: this process's own names */ }
  const rows = await query(
    `UPDATE job_queue SET status = 'dead', finished_at = NOW(), failed_at = NOW(),
            last_error = 'No handler for job "' || name || '": no worker runs this type of job.'
      WHERE status = 'waiting' AND NOT (name = ANY(?::text[]))
        AND created_at <= NOW() - (?::int * INTERVAL '1 millisecond') AND run_after <= NOW() - (?::int * INTERVAL '1 millisecond')
      RETURNING name`, [[...known], NO_HANDLER_MS(), NO_HANDLER_MS()]);
  for (const r of rows) console.error(`[jobs] no handler for job "${r.name}": stopped`);
  return rows.length;
}
// Done rows are kept a day for /health and the tick figures, then removed.
async function prune() {
  await run(`DELETE FROM job_queue WHERE status = 'done' AND finished_at < NOW() - INTERVAL '1 day'`);
}

let started = false, stopping = false;
const sleepers = new Set();
// Wakes every idle lane (it woke only the last one to fall asleep).
function poke() { for (const w of [...sleepers]) w(); }
const timers = [];
let lanesDone = Promise.resolve();
let buildSha = null;

// DEPLOY-1 · THE WORKER SAYS IT IS THERE. One row per process that runs jobs,
// written every 30 s: its role, its build and the job types it can run. The
// web's /health reads the newest (the worker has no public address), and
// failUnhandled and scripts/ops/queue-requeue.js read the job types.
async function beatProcess() {
  await run(
    `INSERT INTO process_heartbeats (id, role, build_sha, handlers, started_at, seen_at)
     VALUES (?, ?, ?, ?::text[], NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, build_sha = EXCLUDED.build_sha, handlers = EXCLUDED.handlers,
                                    seen_at = NOW(), stopped_at = NULL`,
    [WORKER_ID, role(), buildSha, [...handlers.keys()]]);
  await run(`DELETE FROM process_heartbeats WHERE seen_at < NOW() - INTERVAL '7 days'`);
}

function start({ scheduler = true, build = null } = {}) {
  if (scheduler) startLocal();   // every role, the web included: its /health reads these
  if (started || !runsJobs()) return;
  started = true;
  buildSha = build;
  const every = (fn, ms, first = ms) => {
    const t = setTimeout(() => { fn(); const i = setInterval(fn, ms); if (i.unref) i.unref(); timers.push(i); }, first);
    if (t.unref) t.unref(); timers.push(t);
  };
  if (scheduler) every(() => scheduleDue().catch(e => console.error("[jobs] schedule:", e.message)), 10000, 2000);
  every(() => { reapStale().catch(e => console.error("[jobs] reap:", e.message)); prune().catch(() => {});
                failUnhandled().catch(e => { if (!/does not exist/.test(e.message)) console.error("[jobs] no-handler sweep:", e.message); }); },
        REAP_MS(), Math.min(5000, REAP_MS()));
  every(() => beatProcess().catch(e => { if (!/does not exist/.test(e.message)) console.error("[jobs] heartbeat:", e.message); }), 30000, 0);
  const lane = async () => {
    while (!stopping) {
      let job = null;
      try { job = await claim(); } catch (e) { if (!/does not exist/.test(e.message)) console.error("[jobs] claim:", e.message); }
      if (stopping && job) { await giveBack(job.id, job.locked_by, { error: "Handed back: its worker was shutting down.", failed: false, tryBack: true }).catch(() => {}); break; }
      if (job) { await runOne(job); continue; }
      await new Promise(res => {
        let t = null;
        function done() { sleepers.delete(done); clearTimeout(t); res(); }
        t = setTimeout(done, POLL_MS()); if (t.unref) t.unref();
        sleepers.add(done);
      });
    }
  };
  lanesDone = Promise.all(Array.from({ length: CONCURRENCY() }, () => lane()));
  // JOBS-1: the outbox's sweep relays any event its door could not.
  require("./server/shared/outbox").startSweep();
  console.log(`[jobs] ${role() === "both" ? "this process runs the web and the jobs" : "worker"}: ${CONCURRENCY()} lanes, ${ORG_CAP()} per org`);
}

// DEPLOY-1 · SIGTERM. Claim nothing more; let what is running finish for up to
// `graceMs`; hand back what is still going (to waiting, not counted as a try,
// due at once) so the next worker runs it; say this process has stopped.
// Returns what it handed back.
async function stop({ graceMs = 20000 } = {}) {
  if (!started || stopping) return { handedBack: 0 };
  stopping = true;
  for (const t of timers) { clearTimeout(t); clearInterval(t); }
  poke();
  await Promise.race([lanesDone, new Promise(r => { const t = setTimeout(r, graceMs); if (t.unref) t.unref(); })]);
  let handedBack = 0;
  for (const job of [...held.values()]) {
    const s = await giveBack(job.id, job.locked_by, { error: "Handed back: its worker was shutting down.", failed: false, tryBack: true }).catch(() => null);
    if (s) { handedBack++; held.delete(job.id); console.log(`[jobs] handed back ${job.name}${job.org_id ? " " + job.org_id : ""} (it runs again on the next worker)`); }
  }
  await run(`UPDATE process_heartbeats SET stopped_at = NOW() WHERE id = ?`, [WORKER_ID]).catch(() => {});
  return { handedBack };
}
const holding = () => held.size;

// ── What /health and the Admin console read ───────────────────────────────
let health = { queue: { waiting: null, running: null, failedLastHour: null, oldestWaitingSeconds: null },
               tick: { lastRunSeconds: null, slowestOrg: null } };
async function refreshHealth() {
  const [q] = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'waiting')::int AS waiting,
            COUNT(*) FILTER (WHERE status = 'running')::int AS running,
            COUNT(*) FILTER (WHERE failed_at > NOW() - INTERVAL '1 hour')::int AS failed,
            COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(run_after) FILTER (WHERE status = 'waiting' AND run_after <= NOW())), 0)::int AS oldest
       FROM job_queue`);
  // DEPLOY-1: the oldest waiting job by type, and how many running rows have
  // gone silent past STALE_MS (the reaper gives them back within a minute; a
  // count that stays says the reaper is not running: no worker).
  const [old] = await query(
    `SELECT name, EXTRACT(EPOCH FROM NOW() - run_after)::int AS secs FROM job_queue
      WHERE status = 'waiting' AND run_after <= NOW() ORDER BY run_after LIMIT 1`);
  const [st] = await query(
    `SELECT COUNT(*)::int AS n FROM job_queue
      WHERE status = 'running' AND COALESCE(heartbeat_at, started_at, created_at) < NOW() - (?::int * INTERVAL '1 millisecond')`, [STALE_MS()]);
  // The newest-started worker heard from in the last two minutes (during a
  // deploy the old one beats until it stops; the new one is the answer).
  let worker = null;
  try {
    const [w] = await query(
      `SELECT role, build_sha, EXTRACT(EPOCH FROM NOW() - seen_at)::int AS secs FROM process_heartbeats
        WHERE role IN ('worker','both') AND stopped_at IS NULL AND seen_at > NOW() - INTERVAL '2 minutes'
        ORDER BY started_at DESC LIMIT 1`);
    if (w) worker = { role: w.role, buildSha: w.build_sha || null, seenSecondsAgo: w.secs };
  } catch (_) { /* table not there yet */ }
  // The tick: the latest five-minute round of per-org syncs that has finished,
  // how long it took from first start to last finish, and its slowest org.
  const [t] = await query(
    `WITH r AS (SELECT round FROM job_queue WHERE name = 'mailboxSync' AND round IS NOT NULL
                 GROUP BY round HAVING BOOL_AND(status IN ('done','dead')) ORDER BY MAX(finished_at) DESC LIMIT 1)
     SELECT EXTRACT(EPOCH FROM MAX(j.finished_at) - MIN(j.started_at))::int AS secs,
            (ARRAY_AGG(j.org_id ORDER BY j.finished_at - j.started_at DESC))[1] AS slowest
       FROM job_queue j JOIN r ON r.round = j.round`);
  // JOBS-1: a handler (what follows a gift or a change) that stopped after
  // its last try, by name, this week. Names and counts only: /health is public.
  const stopped = (await query(
    `SELECT name, COUNT(*)::int AS n FROM job_queue
      WHERE status = 'dead' AND name LIKE 'handler:%' AND failed_at > NOW() - INTERVAL '7 days'
      GROUP BY name ORDER BY name`)).map(r => ({ name: r.name.replace(/^handler:/, ""), n: r.n }));
  const oldest = old ? { name: old.name, seconds: old.secs } : null;
  health = {
    queue: { waiting: q.waiting, running: q.running, failedLastHour: q.failed, oldestWaitingSeconds: q.oldest, role: role(), stopped,
             oldestWaiting: oldest, stuckRunning: st.n, level: queueLevel(q.oldest, st.n) },
    worker,
    tick: { lastRunSeconds: t && t.secs != null ? t.secs : null, slowestOrg: t ? t.slowest || null : null },
  };
  return health;
}
const healthNow = () => health;
// DEPLOY-1: red when anything has waited over a day, yellow over an hour or
// when a running row has gone silent; the same rule for /health and status.
function queueLevel(oldestWaitingSeconds, stuckRunning = 0) {
  const s = Number(oldestWaitingSeconds) || 0;
  if (s > 24 * 3600) return "red";
  if (s > 3600 || Number(stuckRunning) > 0) return "yellow";
  return "ok";
}

async function deadJobs(limit = 100) {
  return query(
    `SELECT j.id, j.name, j.org_id, o.name AS org_name, j.attempts, j.last_error, j.failed_at, j.created_at
       FROM job_queue j LEFT JOIN orgs o ON o.id = j.org_id
      WHERE j.status = 'dead' ORDER BY j.failed_at DESC NULLS LAST LIMIT ?`, [limit]);
}
// Retry from the Admin console: back to waiting, its tries reset. A key that
// already has a waiting row is already going to run, so the dead row is
// closed instead of doubled.
async function retry(id) {
  const [j] = await query(`SELECT * FROM job_queue WHERE id = ? AND status = 'dead'`, [id]);
  if (!j) return null;
  const [w] = await query(`SELECT id FROM job_queue WHERE key = ? AND status = 'waiting'`, [j.key]);
  if (w) { await run(`UPDATE job_queue SET status = 'done', finished_at = NOW() WHERE id = ?`, [id]); return { id: w.id, merged: true }; }
  await run(`UPDATE job_queue SET status = 'waiting', attempts = 0, run_after = NOW(), last_error = NULL, failed_at = NULL WHERE id = ?`, [id]);
  if (runsJobs()) poke();
  return { id, merged: false };
}

// Whether a key has a row waiting or running (Undo waits on this).
async function keyBusy(key) {
  const rows = await query(`SELECT 1 FROM job_queue WHERE key = ? AND status IN ('waiting','running') LIMIT 1`, [key]);
  return rows.length > 0;
}

module.exports = { define, handle, enqueue, start, stop, holding, startLocal, role, runsJobs, refreshHealth, healthNow, deadJobs, retry, keyBusy,
  scheduleDue, claim, poke, reapStale, failUnhandled, giveBack, queueLevel, MAX_ATTEMPTS, WORKER_ID, STALE_MS, TIMEOUT_MS };
