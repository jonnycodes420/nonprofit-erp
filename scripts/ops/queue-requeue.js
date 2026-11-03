#!/usr/bin/env node
// DEPLOY-1 · Clear the background queue's stuck jobs, by hand.
//
// Prod's /health showed 9 jobs waiting and 8 running, the oldest waiting 15
// days, from before the worker split. From DEPLOY-1 on the worker clears these
// itself (jobQueue.js reapStale and failUnhandled); this is the same rule, run
// once by Jonathan, and it says what it would do before it does anything:
//
//   • a RUNNING job whose lease ran out (no heartbeat for 10 minutes, or
//     running past its one-hour lease) and whose type a worker can run: back
//     to waiting, due now. If its key already has a waiting row, that row is
//     the same run, so this one is closed into it. One already at its last try
//     gets that one try back.
//   • a job (waiting, or running with its lease out) whose type NO worker can
//     run: stopped (`dead`) with "No handler for job X". It then shows on the
//     Admin console's failed jobs, where it can be retried or left.
//
// Which types a worker can run is read from the worker's own heartbeat row
// (process_heartbeats, written every 30 s from DEPLOY-1 on). With no worker
// heard from in 10 minutes it stops nothing and says so: run it after the
// DEPLOY-1 deploy, with the worker up.
//
// DRY RUN BY DEFAULT: it lists what it would do, by type and org, with ids,
// and writes nothing. `--apply` writes, one row per statement, each guarded by
// the state it read (a row that moved meanwhile is left alone). It prints ids,
// types and org ids only, never a payload. It never runs at deploy.
//
//   DATABASE_URL=… node scripts/ops/queue-requeue.js [--org=<id>]
//   DATABASE_URL=… node scripts/ops/queue-requeue.js --apply --i-know-this-is-prod [--org=<id>]
// --org=<id> limits it to one organisation's jobs (try one first).
//
// --apply resolves its database through scripts/lib/prodGuard.js: a remote
// DATABASE_URL needs --i-know-this-is-prod as well.
"use strict";

const apply = process.argv.includes("--apply");
if (apply) process.env.DATABASE_URL = require("../lib/prodGuard").writerDbUrl();
if (!process.env.DATABASE_URL) { console.error("Set DATABASE_URL first."); process.exit(1); }

const STALE_MIN = 10, LEASE_MIN = 60;
const orgArg = process.argv.find(a => a.startsWith("--org="));
const ORG = orgArg ? orgArg.slice(6) : null;
// Every WHERE below carries the org filter; ORG is bound as a parameter, never pasted.
const IN_ORG = "(?::text IS NULL OR org_id = ?)";

async function plan(query, org = ORG) {
  let worker = null;
  try {
    [worker] = await query(
      `SELECT role, build_sha, handlers, EXTRACT(EPOCH FROM NOW() - seen_at)::int AS secs FROM process_heartbeats
        WHERE role IN ('worker','both') AND stopped_at IS NULL AND seen_at > NOW() - INTERVAL '${STALE_MIN} minutes'
        ORDER BY started_at DESC LIMIT 1`);
  } catch (e) { if (!/does not exist/.test(e.message)) throw e; }
  const known = worker ? new Set(worker.handlers || []) : null;
  const expired = await query(
    `SELECT id, name, org_id, attempts, max_attempts,
            EXISTS (SELECT 1 FROM job_queue w WHERE w.key = j.key AND w.status = 'waiting') AS has_twin,
            CASE WHEN COALESCE(heartbeat_at, started_at, created_at) < NOW() - INTERVAL '${STALE_MIN} minutes'
                 THEN 'no heartbeat for ${STALE_MIN} minutes' ELSE 'past its ${LEASE_MIN}-minute lease' END AS why
       FROM job_queue j
      WHERE status = 'running' AND ${IN_ORG}
        AND (COALESCE(heartbeat_at, started_at, created_at) < NOW() - INTERVAL '${STALE_MIN} minutes'
             OR COALESCE(started_at, created_at) < NOW() - INTERVAL '${LEASE_MIN} minutes')
      ORDER BY started_at NULLS FIRST`, [org, org]);
  const waiting = known ? await query(
    `SELECT id, name, org_id FROM job_queue WHERE status = 'waiting' AND ${IN_ORG} AND NOT (name = ANY(?::text[])) ORDER BY run_after`,
    [org, org, [...known]]) : [];
  const actions = [];
  for (const r of expired) {
    if (known && !known.has(r.name)) actions.push({ ...r, from: "running", act: "stop", why: `${r.why}; no worker runs ${r.name}` });
    else actions.push({ ...r, from: "running", act: r.has_twin ? "close" : "requeue", why: r.why });
  }
  for (const r of waiting) actions.push({ ...r, from: "waiting", act: "stop", why: `no worker runs ${r.name}` });
  return { worker, actions };
}

const WORDS = { requeue: "back to waiting", close: "closed into the run already waiting", stop: "stopped: no handler" };

async function main() {
  const { query, run } = require("../../db");
  const JQ = require("../../jobQueue");
  const { worker, actions } = await plan(query);
  console.log(`queue-requeue · ${apply ? "APPLY" : "dry run (nothing is written; --apply to write)"}${ORG ? ` · org ${ORG} only` : ""}`);
  console.log(worker
    ? `worker heard from ${worker.secs}s ago: role ${worker.role}, build ${String(worker.build_sha || "none").slice(0, 7)}, ${worker.handlers.length} job types`
    : `no worker heard from in ${STALE_MIN} minutes: expired leases are given back, but no job is stopped for want of a handler`);
  if (!actions.length) { console.log("nothing stuck."); return { worker, actions, done: 0 }; }
  const groups = new Map();
  for (const a of actions) {
    const k = `${WORDS[a.act]} · ${a.name} · ${a.org_id || "(no org)"}`;
    groups.set(k, [...(groups.get(k) || []), a]);
  }
  for (const [k, list] of groups) {
    console.log(`  ${list.length} × ${k}`);
    for (const a of list) console.log(`      ${a.id}  (${a.from}; ${a.why}; try ${a.attempts ?? "-"} of ${a.max_attempts ?? "-"})`);
  }
  if (!apply) return { worker, actions, done: 0 };
  let done = 0;
  for (const a of actions) {
    if (a.act === "stop") {
      const r = await run(
        `UPDATE job_queue SET status = 'dead', locked_by = NULL, finished_at = NOW(), failed_at = NOW(),
                last_error = ? WHERE id = ? AND status = ?`,
        [`No handler for job "${a.name}": no worker runs this type of job.`, a.id, a.from]);
      done += r.changes;
    } else {
      // One more try for a row that is out of them.
      if (a.attempts >= a.max_attempts) await run(`UPDATE job_queue SET attempts = max_attempts - 1 WHERE id = ? AND status = 'running'`, [a.id]);
      const s = await JQ.giveBack(a.id, null, { error: `Given back by hand (queue-requeue): ${a.why}.` });
      if (s) done++;
    }
  }
  console.log(`applied: ${done} of ${actions.length} row(s) changed${done < actions.length ? " (the rest moved since they were read)" : ""}.`);
  return { worker, actions, done };
}

module.exports = { plan, main };

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error("queue-requeue failed:", e.message); process.exit(1); });
}
