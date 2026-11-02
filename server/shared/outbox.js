// JOBS-1 · THE OUTBOX. WHAT FOLLOWS A CHANGE IS AN EVENT, AND AN EVENT IS A ROW.
//
// Before JOBS-1, recordGift called its reactions (the thank-you draft, the
// sequences, the journeys, the after-change step) one after another, each in
// its own try/catch. When one threw, the gift saved, the step never happened,
// a line went to the log, and nothing tried again.
//
// Now a door writes an event in the same transaction as its row (recordGift
// writes it in the same statement as the gift), and the relay moves it onto
// the queue (jobQueue.js): one job per handler that applies, each tried again
// with a backoff and, after the last try, listed as stopped on /health, the
// Admin console's failed jobs and `npm run status`. Never silently.
//
//   events_outbox  one row per event: `gift.recorded`, `donor.changed`, ...
//                  `ready` is false while the door is still writing the facts
//                  its handlers read; a row left not ready (its process died
//                  mid-write) is relayed after STALE_MS and its handlers read
//                  the facts live.
//   the relay      one statement marks the event relayed AND inserts its jobs,
//                  so an event is moved once, however many processes relay.
//                  The door relays its own event the moment it is ready; a
//                  sweep in every process that runs jobs relays the rest.
//   a handler      `on(type, name, run, { applies })`, one file each under
//                  server/<domain>/handlers/. Its job is "handler:<name>",
//                  keyed "ev:<event id>:<name>", its round the event id. Every
//                  handler is idempotent: run twice, the same result.
"use strict";
const { query, uuid } = require("../../db");

const STALE_MS = () => Math.max(500, Number(process.env.OUTBOX_STALE_MS) || 60 * 1000);
const SWEEP_MS = () => Math.max(200, Number(process.env.OUTBOX_SWEEP_MS) || 5000);

const handlers = new Map();   // type -> [{ name, applies }]
let deps = {};
// server.js hands over what the handlers call (recordGift's old reactions live
// there), once, at boot.
function configure(d) { deps = { ...deps, ...d }; }
const dep = (name) => {
  if (typeof deps[name] !== "function") throw new Error(`outbox: ${name} is not configured in this process`);
  return deps[name];
};

const jobName = (name) => `handler:${name}`;
// One job name per handler name; a handler name may serve several event types
// (the after-change step follows both gift.recorded and donor.changed), so the
// job reads its event and runs that type's function.
const runs = new Map();   // `${type}|${name}` -> run
function on(type, name, run, { applies = () => true, maxAttempts = 5 } = {}) {
  const list = handlers.get(type) || [];
  if (!list.some(h => h.name === name)) list.push({ name, applies, maxAttempts });
  handlers.set(type, list);
  runs.set(`${type}|${name}`, run);
  require("../../jobQueue").handle(jobName(name), async (p) => {
    const [ev] = await query(`SELECT id, org_id, type, payload, donor_ids, ready FROM events_outbox WHERE id = ?`, [p.eventId]);
    if (!ev) return;   // pruned: it ran long ago
    const fn = runs.get(`${ev.type}|${name}`);
    if (!fn) throw new Error(`No ${name} handler for ${ev.type} in this process`);
    const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : (ev.payload || {});
    await fn({ ...payload, eventId: ev.id, orgId: ev.org_id, donorIds: ev.donor_ids || [], ready: ev.ready === true }, deps);
  });
}

const ACTOR = { id: "system:outbox", name: "Steward (what follows a change)" };
const newId = () => "ev_" + uuid().replace(/-/g, "").slice(0, 20);

// The columns and values recordGift puts in its gift statement's CTE.
function rowFor(orgId, type, payload, { donorIds = [], ready = true, actor = null, id = newId() } = {}) {
  return { id, orgId, type, payload: JSON.stringify(payload || {}), donorIds: [...new Set(donorIds.filter(Boolean))], ready,
           by: (actor && actor.id) || ACTOR.id, byName: (actor && actor.name) || ACTOR.name };
}

// Write one event (a door that has no statement of its own to share). Inside
// an ambient transaction (an import) it commits, or not, with the import.
async function write(orgId, type, payload, opts = {}) {
  const r = rowFor(orgId, type, payload, opts);
  await query(
    `INSERT INTO events_outbox (id, org_id, type, payload, donor_ids, ready, created_by, created_by_name)
     VALUES (?,?,?,?::jsonb,?::text[],?,?,?)`, [r.id, r.orgId, r.type, r.payload, r.donorIds, r.ready, r.by, r.byName]);
  return r.id;
}

// The door has written the facts: merge them in and mark the event ready.
async function markReady(id, facts = {}) {
  await query(`UPDATE events_outbox SET payload = payload || ?::jsonb, ready = TRUE WHERE id = ?`, [JSON.stringify(facts), id]);
}

// Move events onto the queue. `ids` relays those (a door's own, ready or not);
// without it, every ready event and every one left not ready past STALE_MS.
async function relay(ids = null) {
  const rows = ids
    ? await query(`SELECT id, org_id, type, payload, ready FROM events_outbox WHERE id = ANY(?::text[]) AND relayed_at IS NULL`, [ids])
    : await query(
      `SELECT id, org_id, type, payload, ready FROM events_outbox
        WHERE relayed_at IS NULL AND (ready OR created_at < NOW() - (?::int * INTERVAL '1 millisecond'))
        ORDER BY created_at LIMIT 500`, [STALE_MS()]);
  if (!rows.length) return 0;
  const J = { id: [], name: [], org: [], key: [], payload: [], round: [], max: [] };
  for (const ev of rows) {
    const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : (ev.payload || {});
    for (const h of handlers.get(ev.type) || []) {
      if (!h.applies({ ...payload, ready: ev.ready })) continue;
      J.id.push("job_" + uuid().replace(/-/g, "").slice(0, 20)); J.name.push(jobName(h.name)); J.org.push(ev.org_id);
      J.key.push(`ev:${ev.id}:${h.name}`); J.payload.push(JSON.stringify({ eventId: ev.id })); J.round.push(ev.id); J.max.push(h.maxAttempts);
    }
  }
  // ONE statement: the events this call marks relayed get their jobs, and an
  // event another process marked first gets none from this one.
  const moved = await query(
    `WITH ev AS (UPDATE events_outbox SET relayed_at = NOW() WHERE id = ANY(?::text[]) AND relayed_at IS NULL RETURNING id),
          ins AS (INSERT INTO job_queue (id, name, org_id, key, payload, status, priority, run_after, round, max_attempts, created_by, created_by_name)
                  SELECT j.id, j.name, j.org, j.key, j.payload::jsonb, 'waiting', 3, NOW(), j.round, j.max, ?, ?
                    FROM unnest(?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::text[], ?::int[]) AS j(id, name, org, key, payload, round, max)
                   WHERE j.round IN (SELECT id FROM ev)
                  ON CONFLICT (key) WHERE status = 'waiting' DO NOTHING RETURNING id)
     SELECT (SELECT COUNT(*) FROM ev)::int AS events, (SELECT COUNT(*) FROM ins)::int AS jobs`,
    [rows.map(r => r.id), ACTOR.id, ACTOR.name, J.id, J.name, J.org, J.key, J.payload, J.round, J.max]);
  const out = moved[0] || { events: 0, jobs: 0 };
  if (out.jobs) { const JQ = require("../../jobQueue"); if (JQ.runsJobs()) JQ.poke(); }
  return out.events;
}
// A door relays its own event without making its caller wait on a failure:
// the sweep relays whatever this could not.
function relaySoon(id) {
  relay([id]).catch(e => console.error("[outbox] relay:", e.message));
}

// The sweep, in every process that runs jobs (the worker, or the one process).
let sweeping = false;
function startSweep() {
  if (sweeping) return;
  sweeping = true;
  const go = () => relay().catch(e => { if (!/does not exist/.test(e.message)) console.error("[outbox] sweep:", e.message); });
  const t = setTimeout(go, 1000); if (t.unref) t.unref();
  const i = setInterval(go, SWEEP_MS()); if (i.unref) i.unref();
  const p = setInterval(() => prune().catch(() => {}), 60 * 60 * 1000); if (p.unref) p.unref();
}
// Relayed events are kept a week (the job rows a day), then removed.
async function prune() {
  await query(`DELETE FROM events_outbox WHERE relayed_at < NOW() - INTERVAL '7 days'`);
}

// HONEST SCREENS: is a recompute still owed for these people (or, with no
// ids, anyone in the org)? An event not yet relayed, or its after-change job
// waiting or running, or the org's scores waiting or running (a percentile is
// the whole org's). A figure that reads true says "updating…" instead of
// showing the answer from before the change as current.
async function pending(orgId, donorIds = null) {
  const ids = donorIds ? [...new Set(donorIds.filter(Boolean))] : null;
  const [r] = await query(
    `SELECT EXISTS (
       SELECT 1 FROM events_outbox e
        WHERE e.org_id = ? ${ids ? "AND e.donor_ids && ?::text[]" : ""}
          AND e.created_at > NOW() - INTERVAL '1 day'
          AND (e.relayed_at IS NULL OR EXISTS (
                SELECT 1 FROM job_queue j WHERE j.round = e.id AND j.name = 'handler:afterChange'
                   AND j.status IN ('waiting','running'))))
        OR EXISTS (SELECT 1 FROM job_queue j WHERE j.key = 'scores:' || ? AND j.status IN ('waiting','running')) AS updating`,
    ids ? [orgId, ids, orgId] : [orgId, orgId]);
  return !!(r && r.updating);
}

// A door a person is waiting on (To confirm shows the thank-you draft in its
// answer) may run one handler now, in the request. Every handler is
// idempotent, so the queued copy finds the work done; a failure here is left
// to the queued copy, which tries again.
async function runNow(eventId, name) {
  const [ev] = await query(`SELECT id, org_id, type, payload, donor_ids, ready FROM events_outbox WHERE id = ?`, [eventId]);
  const fn = ev && runs.get(`${ev.type}|${name}`);
  const h = ev && (handlers.get(ev.type) || []).find(x => x.name === name);
  if (!fn || !h) return false;
  const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : (ev.payload || {});
  const p = { ...payload, eventId: ev.id, orgId: ev.org_id, donorIds: ev.donor_ids || [], ready: ev.ready === true };
  if (!h.applies(p)) return false;
  try { await fn(p, deps); return true; } catch (e) { console.error(`[outbox] ${name} now (the queue will try again):`, e.message); return false; }
}

// For a door whose own follow-up must come after one handler (To confirm's
// "call to thank" goes on the Thread after the gift's journeys have had their
// turn, as it always did): resolves once that handler's job for the event has
// run (or failed for good), or there is none, or after `timeoutMs`.
async function handled(eventId, name, { timeoutMs = 30000 } = {}) {
  if (!eventId) return true;
  const until = Date.now() + timeoutMs;
  for (;;) {
    const [ev] = await query(`SELECT relayed_at FROM events_outbox WHERE id = ?`, [eventId]);
    if (!ev) return true;
    if (ev.relayed_at) {
      const [j] = await query(`SELECT 1 FROM job_queue WHERE key = ? AND status IN ('waiting','running') LIMIT 1`, [`ev:${eventId}:${name}`]);
      if (!j) return true;
    }
    if (Date.now() >= until) return false;
    await new Promise(r => setTimeout(r, 100));
  }
}

module.exports = { handled, runNow, configure, dep, on, handlers, rowFor, write, markReady, relay, relaySoon, startSweep, prune, pending,
  ACTOR, STALE_MS, jobName };
