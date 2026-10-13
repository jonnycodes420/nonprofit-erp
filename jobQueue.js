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
const os = require("os");
const { query, run, uuid, withTransaction } = require("./db");

const MAX_ATTEMPTS = 5;
const ORG_CAP = () => Math.max(1, Number(process.env.JOB_ORG_CAP) || 2);
const CONCURRENCY = () => Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 4);
const POLL_MS = () => Math.max(50, Number(process.env.JOB_POLL_MS) || 1000);
// A running row whose worker has not touched it in this long is taken to have
// died with its process, and goes back to waiting (it counts as a try).
const STALE_MS = () => Math.max(5000, Number(process.env.JOB_STALE_MS) || 10 * 60 * 1000);
const WORKER_ID = `${os.hostname()}:${process.pid}`;

const schedules = new Map();   // name -> { everyMs, firstMs, run }
const handlers = new Map();    // name -> async (payload, job) => result

function role() {
  const r = String(process.env.STEWARD_PROCESS || "").trim().toLowerCase();
  return r === "web" || r === "worker" ? r : "both";
}
const runsJobs = () => role() !== "web";

// A periodic job. `run` is what the old setInterval called.
function define(name, { everyMs, firstMs = null, run: fn }) {
  schedules.set(name, { everyMs, firstMs: firstMs == null ? everyMs : firstMs, run: fn });
  handlers.set(name, () => fn());
}
// A job that is only ever enqueued (one org's sync, an import's recent gifts).
function handle(name, fn) { handlers.set(name, fn); }

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
// running, and its org under the per-org cap.
//
// SKIP LOCKED means two workers racing for the same row do not wait on each
// other. The per-org cap and the one-run-per-key rule are checked AFTER an
// advisory lock on the org and on the key, in a fresh statement: checked in
// the same statement as the pick, four lanes claiming at once each saw "under
// the cap" in their own snapshot and one org took every lane (scale1-queue §4).
async function claim() {
  return withTransaction(async (c) => {
    const names = [...handlers.keys()], full = [], passed = [];
    for (let i = 0; i < 8; i++) {
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
          WHERE id = $1 RETURNING *`, [cand.id, WORKER_ID]);
      return r.rows[0] || null;
    }
    return null;
  });
}

const BACKOFF_MS = () => Math.max(10, Number(process.env.JOB_BACKOFF_MS) || 30000);
const backoffMs = attempts => Math.min(30 * 60 * 1000, BACKOFF_MS() * 2 ** Math.max(0, attempts - 1));

async function finish(job, err) {
  if (!err) {
    await run(`UPDATE job_queue SET status='done', finished_at=NOW(), last_error=NULL WHERE id=? AND locked_by=?`, [job.id, WORKER_ID]);
    return;
  }
  const msg = String(err && err.message || err).slice(0, 500);
  const dead = job.attempts >= (job.max_attempts || MAX_ATTEMPTS);
  await run(
    `UPDATE job_queue SET status = ?, finished_at = NOW(), last_error = ?,
            run_after = NOW() + (?::int * INTERVAL '1 millisecond'), failed_at = NOW()
      WHERE id = ? AND locked_by = ?`,
    [dead ? "dead" : "waiting", msg, dead ? 0 : backoffMs(job.attempts), job.id, WORKER_ID]);
  console.error(`[jobs] ${job.name}${job.org_id ? " " + job.org_id : ""} failed (try ${job.attempts}): ${msg}${dead ? " · stopped" : ""}`);
}

async function runOne(job) {
  const fn = handlers.get(job.name);
  // Keep the row alive while it runs, so a long run is not mistaken for a
  // dead worker.
  const beat = setInterval(() => {
    run(`UPDATE job_queue SET heartbeat_at = NOW() WHERE id = ? AND locked_by = ?`, [job.id, WORKER_ID]).catch(() => {});
  }, 30000);
  if (beat.unref) beat.unref();
  try {
    if (!fn) throw new Error(`No handler for job "${job.name}" in this process`);
    const payload = typeof job.payload === "string" ? JSON.parse(job.payload) : job.payload;
    await fn(payload || {}, job);
    await finish(job, null);
  } catch (e) {
    await finish(job, e).catch(x => console.error("[jobs] could not record a failure:", x.message));
  } finally { clearInterval(beat); }
}

// ── The scheduler: enqueue each due periodic job, once across all processes.
async function scheduleDue() {
  for (const [name, s] of schedules) {
    await run(
      `INSERT INTO job_schedule (name, every_ms, next_run_at) VALUES (?, ?, NOW() + (?::int * INTERVAL '1 millisecond'))
       ON CONFLICT (name) DO UPDATE SET every_ms = EXCLUDED.every_ms`, [name, s.everyMs, s.firstMs]);
    const due = await query(
      `UPDATE job_schedule SET next_run_at = NOW() + (every_ms * INTERVAL '1 millisecond'), last_enqueued_at = NOW()
        WHERE name = ? AND next_run_at <= NOW() RETURNING name`, [name]);
    if (due.length) await enqueue({ name, key: name, round: `${name}@${Date.now()}` });
  }
}
// A worker that died mid-run leaves its row running. Give it back.
async function reapStale() {
  await run(
    `UPDATE job_queue SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'waiting' END,
            last_error = COALESCE(last_error, 'The worker running this stopped before it finished.'), locked_by = NULL
      WHERE status = 'running' AND heartbeat_at < NOW() - (?::int * INTERVAL '1 millisecond')`, [STALE_MS()]);
}
// Done rows are kept a day for /health and the tick figures, then removed.
async function prune() {
  await run(`DELETE FROM job_queue WHERE status = 'done' AND finished_at < NOW() - INTERVAL '1 day'`);
}

let started = false, wake = null, busy = 0;
function poke() { if (wake) { const w = wake; wake = null; w(); } }

function start({ scheduler = true } = {}) {
  if (started || !runsJobs()) return;
  started = true;
  if (scheduler) {
    const tick = () => scheduleDue().catch(e => console.error("[jobs] schedule:", e.message));
    setTimeout(tick, 2000).unref();
    setInterval(tick, 10000).unref();
  }
  setInterval(() => { reapStale().catch(() => {}); prune().catch(() => {}); }, 60000).unref();
  const lane = async () => {
    for (;;) {
      let job = null;
      try { job = await claim(); } catch (e) { if (!/does not exist/.test(e.message)) console.error("[jobs] claim:", e.message); }
      if (job) { busy++; try { await runOne(job); } finally { busy--; } continue; }
      await new Promise(res => { wake = res; const t = setTimeout(res, POLL_MS()); if (t.unref) t.unref(); });
    }
  };
  for (let i = 0; i < CONCURRENCY(); i++) lane();
  console.log(`[jobs] ${role() === "both" ? "this process runs the web and the jobs" : "worker"}: ${CONCURRENCY()} lanes, ${ORG_CAP()} per org`);
}

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
  // The tick: the latest five-minute round of per-org syncs that has finished,
  // how long it took from first start to last finish, and its slowest org.
  const [t] = await query(
    `WITH r AS (SELECT round FROM job_queue WHERE name = 'mailboxSync' AND round IS NOT NULL
                 GROUP BY round HAVING BOOL_AND(status IN ('done','dead')) ORDER BY MAX(finished_at) DESC LIMIT 1)
     SELECT EXTRACT(EPOCH FROM MAX(j.finished_at) - MIN(j.started_at))::int AS secs,
            (ARRAY_AGG(j.org_id ORDER BY j.finished_at - j.started_at DESC))[1] AS slowest
       FROM job_queue j JOIN r ON r.round = j.round`);
  health = {
    queue: { waiting: q.waiting, running: q.running, failedLastHour: q.failed, oldestWaitingSeconds: q.oldest },
    tick: { lastRunSeconds: t && t.secs != null ? t.secs : null, slowestOrg: t ? t.slowest || null : null },
  };
  return health;
}
const healthNow = () => health;

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

module.exports = { define, handle, enqueue, start, role, runsJobs, refreshHealth, healthNow, deadJobs, retry, keyBusy,
  scheduleDue, claim, MAX_ATTEMPTS, WORKER_ID, _busy: () => busy };
