// server/insights/store.js · INSIGHTS-2. INSIGHTS ARE BUILT ON THE WORKER, AND
// A REQUEST ONLY READS THEM.
//
// LOAD-1 found the tail of every page under load: each recorded gift changed
// the org's Insights fingerprint, and the next profile open rebuilt the whole
// org's Insights inside the request (insights.computeInsights over every gift:
// 1 to 1.5 s of the web's one CPU on a 25,000-person org), while every other
// org's request waited behind it.
//
// Now:
//   build    the job `handler:insights` (key insights:<org>, one per org at a
//            time) reads the org's rows, runs computeInsights, and stores the
//            answer in stored_insights with the fingerprint it was built from.
//            The fingerprint is read BEFORE the rows, so a write that lands
//            while it builds leaves the stored answer stale, never wrongly
//            fresh.
//   schedule a change asks for a build (afterChange.js, the Insights buttons,
//            and a read that finds its answer stale). While one build waits,
//            another ask is the same build (the queue keeps one waiting row
//            per key); while one runs, an ask makes the one waiting row, so
//            ten gifts in a minute are one or two builds, never ten.
//   read     a request reads the stored answer and the org's fingerprint now.
//            Equal: fresh. Different: the stored answer is served with
//            stale: true and a build is queued. None stored yet: the caller
//            gets { preparing: true } and says "Insights are being prepared";
//            a build is queued. A request NEVER runs computeInsights.
//
// One wait, bounded: a request may wait for a queued build to land (the
// Insights buttons do, so the card she just closed is gone when the panel
// reloads; TEST_MODE reads do, so a suite reads what it just wrote). The wait
// is a poll of the stored row: the CPU work is the worker's.
//
// stored_insights is not watched by the org_summary change triggers (orgSummary.js
// UNWATCHED): it is derived from rows that are.
"use strict";
const { query, run } = require("../../db");
const JQ = require("../../jobQueue");

const BUILD_DEBOUNCE_MS = () => Number(process.env.INSIGHTS_BUILD_DEBOUNCE_MS ?? 1500);
const TEST_WAIT_MS = () => Number(process.env.INSIGHTS_TEST_WAIT_MS ?? 30000);
const PREPARING = "Insights are being prepared. They will be here in a moment.";
const KEEP_DAYS = 3;   // older days' answers are deleted when a newer one is stored

let ready = null;
function ensure() {
  return ready || (ready = (async () => {
    await query(`CREATE TABLE IF NOT EXISTS stored_insights (
        org_id TEXT NOT NULL,
        as_of TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        body TEXT NOT NULL,
        built_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ms INTEGER,
        PRIMARY KEY (org_id, as_of))`);
    // SECURE-3: locked like every public table (dbLock re-checks on each boot).
    await query(`ALTER TABLE stored_insights ENABLE ROW LEVEL SECURITY`);
  })().catch(e => { ready = null; throw e; }));
}

// The org's Insights inputs as one string: any write to a gift, pledge, person
// or an Insights decision changes it (moved from insightsData.js, unchanged).
async function fingerprint(orgId) {
  const [f] = await query(`SELECT
      (SELECT COUNT(*)::text || ':' || COALESCE(SUM(amount),0)::text || ':' || COALESCE(MAX(created_at)::text,'') FROM gifts WHERE org_id=?) AS g,
      (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text,'') FROM pledges WHERE org_id=?) AS p,
      (SELECT COUNT(*)::text || ':' || COALESCE(MAX(updated_at)::text,'') FROM donors WHERE org_id=?) AS d,
      (SELECT COUNT(*)::text FROM insight_outcomes WHERE org_id=?) || ':' || (SELECT COUNT(*)::text FROM insight_reviews WHERE org_id=?)
        || ':' || (SELECT COUNT(*)::text FROM insight_links WHERE org_id=?) AS i`, [orgId, orgId, orgId, orgId, orgId, orgId]);
  return `${f.g}|${f.p}|${f.d}|${f.i}`;
}

async function orgTodayOf(orgId) {
  const [o] = await query("SELECT id, timezone FROM orgs WHERE id=?", [orgId]);
  return o ? require("../../orgTime").orgToday(o) : null;
}

// THE BUILD (the worker's). `asOf` is the org's today unless a TEST_MODE read
// asked for another day.
async function build(orgId, asOf = null) {
  await ensure();
  const day = asOf || await orgTodayOf(orgId);
  if (!day) return null;
  const t0 = Date.now();
  const key = await fingerprint(orgId);
  const result = await require("../../insightsData").computeFor(orgId, day);
  const body = JSON.stringify(result);
  const ms = Date.now() - t0;
  await run(`INSERT INTO stored_insights (org_id, as_of, fingerprint, body, built_at, ms) VALUES (?,?,?,?,NOW(),?)
             ON CONFLICT (org_id, as_of) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, body = EXCLUDED.body, built_at = NOW(), ms = EXCLUDED.ms`,
    [orgId, day, key, body, ms]);
  if (!asOf) await run(`DELETE FROM stored_insights WHERE org_id = ? AND as_of < ?`, [orgId, shiftDay(day, -KEEP_DAYS)]);
  stats.builds++; stats.lastMs = ms;
  return { orgId, asOf: day, ms, bytes: body.length };
}
const shiftDay = (d, n) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };

JQ.handle("handler:insights", (p) => build(p.orgId, p.asOf || null));

// Ask for a build. Never throws; resolves once the ask is on the queue. A
// build waits BUILD_DEBOUNCE_MS (asks in that time are the same build), and at
// least twice the org's last build time, so one busy org's builds never take
// more than a third of the worker.
async function schedule(orgId, { asOf = null, laterMs = null } = {}) {
  if (!orgId) return null;
  try {
    let wait = laterMs;
    if (wait == null) {
      await ensure();
      const [last] = await query(`SELECT MAX(ms)::int AS ms FROM stored_insights WHERE org_id = ?`, [orgId]);
      wait = Math.max(BUILD_DEBOUNCE_MS(), 2 * ((last && last.ms) || 0));
    }
    const key = asOf ? `insights:${orgId}:${asOf}` : `insights:${orgId}`;
    const id = await JQ.enqueue({ name: "handler:insights", orgId, key, payload: { orgId, asOf }, runAfterMs: wait });
    // A caller who will wait for the build (a button, a TEST_MODE read) brings
    // a build already waiting out its debounce forward to now.
    if (!id && wait === 0) await query(`UPDATE job_queue SET run_after = LEAST(run_after, NOW()) WHERE key = ? AND status = 'waiting'`, [key]);
    return id;
  } catch (e) { console.error("[insights] enqueue:", e.message); return null; }
}

// Parsed answers, one per stored build, so twenty reads of one build fetch and
// parse it once (the 25,000-person org's answer is ~26 MB: ~150 ms to parse).
const PARSED = new Map();   // org|asOf -> { builtAt, result }
async function parsed(orgId, row) {
  const k = `${orgId}|${row.as_of}`;
  const m = PARSED.get(k);
  if (m && m.builtAt === row.built_at) return m.result;
  const [b] = await query(`SELECT body, built_at::text AS built_at FROM stored_insights WHERE org_id = ? AND as_of = ?`, [orgId, row.as_of]);
  if (!b) return m ? m.result : null;
  const result = JSON.parse(b.body);
  PARSED.set(k, { builtAt: b.built_at, result });
  return result;
}

async function storedRow(orgId, day) {
  await ensure();
  const cols = `as_of, fingerprint, built_at::text AS built_at`;
  const [own] = await query(`SELECT ${cols} FROM stored_insights WHERE org_id = ? AND as_of = ?`, [orgId, day]);
  if (own) return own;
  // Another day's answer (yesterday's, before the morning build) is stale, not missing.
  const [any] = await query(`SELECT ${cols} FROM stored_insights WHERE org_id = ? ORDER BY as_of DESC LIMIT 1`, [orgId]);
  return any || null;
}

// THE READ. { result, stale, preparing, sentence? }. `waitMs`: how long to wait
// for a queued build to land (0 in production reads).
async function read(orgId, asOf, { waitMs = 0, explicitDay = false } = {}) {
  let key = await fingerprint(orgId);
  let row = await storedRow(orgId, asOf);
  const fresh = r => !!r && r.as_of === asOf && r.fingerprint === key;
  if (!fresh(row)) {
    stats.staleReads++;
    await schedule(orgId, { asOf: explicitDay ? asOf : null, laterMs: waitMs > 0 ? 0 : null });
    const until = Date.now() + Math.max(0, waitMs);
    let seen = row && row.built_at;
    while (Date.now() < until) {
      await new Promise(r => setTimeout(r, 100));
      const r2 = await storedRow(orgId, asOf);
      if (fresh(r2)) { row = r2; break; }
      // A build landed from rows newer than the ask (a write since): fresh if
      // nothing has changed since it was built.
      if (r2 && r2.as_of === asOf && r2.built_at !== seen) {
        seen = r2.built_at;
        key = await fingerprint(orgId);
        if (fresh(r2)) { row = r2; break; }
      }
    }
  }
  const result = row && await parsed(orgId, row);
  if (!result) { stats.preparing++; return { result: null, stale: false, preparing: true, sentence: PREPARING }; }
  stats.reads++;
  return { result, stale: !fresh(row), preparing: false, builtAt: row.built_at };
}

// After her click on an Insights button: queue the build now and wait for it
// (bounded), so the panel she reloads no longer shows what she closed.
async function refreshAndWait(orgId, asOf, { waitMs = Number(process.env.INSIGHTS_BUTTON_WAIT_MS ?? 8000), explicitDay = false } = {}) {
  return read(orgId, asOf, { waitMs, explicitDay }).catch(e => { console.error("[insights] refresh:", e.message); return null; });
}

const stats = { builds: 0, lastMs: null, reads: 0, staleReads: 0, preparing: 0 };

module.exports = { ensure, fingerprint, build, schedule, read, refreshAndWait, stats, PREPARING, TEST_WAIT_MS };
