// SCALE-2 · THE PER-ORG SUMMARY.
//
// Home's org-wide figures (impact, stewardship, first touch, the fundraising
// totals, Drift, the giving summary) were recomputed from every gift on every
// visit. With twenty people signed in at once that work queued for the ten
// database connections, and Home took 28 seconds.
//
// Now each of those answers is stored once it is computed, and served from the
// store until something it could depend on changes. "Changes" is decided by the
// database, not by a list of doors: every insert, update or delete on a table
// that carries org_id (and on orgs itself) records one row in org_changes, from
// a statement trigger, in the same transaction as the write. A stored answer
// remembers the oldest transaction still open when its computation began
// (pg_snapshot_xmin). It is served only while no change row for that org has a
// transaction id at or above that mark, so a write that landed during or after
// the computation always forces a fresh one. A stored answer is also for one
// org calendar day only, because "today" moves the figures with nothing new in
// the file.
//
// So the store cannot be stale, whichever door wrote: a gift through any door,
// an import, a webhook, a sweep, a merge, sample data. The after-change step
// and the queue keep it current by recomputing the org's stored answers soon
// after a change, so the next visit finds them ready, and a nightly job
// compares every stored answer with a fresh computation and logs any
// difference.
"use strict";
const { query, run } = require("./db");
const inProcess = require("./inProcess");

let deps = null;   // { orgTz, orgToday, signInternalToken }
function configure(d) { deps = d; }

const off = () => process.env.ORG_SUMMARY_OFF === "1";
// The flag the nightly check and the refresh set on their own request, so the
// route computes fresh instead of answering from the store.
const FRESH = Symbol.for("steward.orgSummary.fresh");

// Tables whose writes never move a figure a person sees: the queue, sessions,
// logs of calls, and the store itself. Everything else with org_id is watched.
const UNWATCHED = new Set([
  "job_queue", "user_sessions", "portal_sessions", "supporter_sessions", "oauth_states",
  "api_call_log", "ai_log", "ai_usage", "question_log", "fin_audit_log", "rate_limit_hits",
  "org_changes", "org_summary",
  // Each person's stored Drift answer: derived from gifts, which are watched.
  "donor_drift",
]);

function schemaSql() {
  return [
    `CREATE TABLE IF NOT EXISTS org_changes (
       id BIGSERIAL PRIMARY KEY,
       org_key TEXT NOT NULL,
       tbl TEXT NOT NULL,
       xid XID8 NOT NULL DEFAULT pg_current_xact_id(),
       at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_org_changes_org_xid ON org_changes (org_key, xid)`,
    `CREATE TABLE IF NOT EXISTS org_summary (
       org_key TEXT NOT NULL,
       key TEXT NOT NULL,
       path TEXT NOT NULL,
       user_id TEXT,
       body TEXT NOT NULL,
       snap_xmin XID8 NOT NULL,
       computed_for TEXT NOT NULL,
       computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       ms INTEGER,
       PRIMARY KEY (org_key, key))`,
    // A route whose answer turns over at a known moment inside the day (an
    // invite expiring) says when, in res.locals.orgSummaryValidUntil.
    `ALTER TABLE org_summary ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ`,
    `CREATE OR REPLACE FUNCTION steward_note_org_change() RETURNS TRIGGER AS $fn$
     BEGIN
       IF TG_OP = 'INSERT' THEN
         INSERT INTO org_changes (org_key, tbl) SELECT DISTINCT org_id::text, TG_TABLE_NAME FROM new_rows WHERE org_id IS NOT NULL;
       ELSIF TG_OP = 'DELETE' THEN
         INSERT INTO org_changes (org_key, tbl) SELECT DISTINCT org_id::text, TG_TABLE_NAME FROM old_rows WHERE org_id IS NOT NULL;
       ELSE
         INSERT INTO org_changes (org_key, tbl)
           SELECT DISTINCT o, TG_TABLE_NAME FROM (SELECT org_id::text AS o FROM new_rows UNION SELECT org_id::text FROM old_rows) x WHERE o IS NOT NULL;
       END IF;
       RETURN NULL;
     END; $fn$ LANGUAGE plpgsql`,
    // orgs has no org_id: its id is the org.
    `CREATE OR REPLACE FUNCTION steward_note_org_row_change() RETURNS TRIGGER AS $fn$
     BEGIN
       IF TG_OP = 'DELETE' THEN
         INSERT INTO org_changes (org_key, tbl) SELECT DISTINCT id::text, 'orgs' FROM old_rows;
       ELSE
         INSERT INTO org_changes (org_key, tbl) SELECT DISTINCT id::text, 'orgs' FROM new_rows;
       END IF;
       RETURN NULL;
     END; $fn$ LANGUAGE plpgsql`,
  ];
}

// Called LAST in initSchema, so every table the init made is watched. Each
// table gets three statement triggers (a transition table belongs to one event).
async function installTriggers(pool) {
  for (const sql of schemaSql()) await pool.query(sql);
  const tables = (await pool.query(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND c.column_name = 'org_id' AND t.table_type = 'BASE TABLE'`)).rows
    .map(r => r.table_name).filter(t => !UNWATCHED.has(t));
  const plan = tables.map(t => [t, "steward_note_org_change"]).concat([["orgs", "steward_note_org_row_change"]]);
  const have = new Set((await pool.query(
    `SELECT c.relname || '.' || t.tgname AS k FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      WHERE t.tgname LIKE 'trg_org_change_%'`)).rows.map(r => r.k));
  // A table someone later marks unwatched loses its triggers.
  for (const k of have) {
    const [t, name] = k.split(".");
    if (UNWATCHED.has(t)) await pool.query(`DROP TRIGGER IF EXISTS ${name} ON "${t}"`);
  }
  for (const [t, fn] of plan) {
    for (const [ev, ref] of [["INSERT", "NEW TABLE AS new_rows"], ["DELETE", "OLD TABLE AS old_rows"],
                             ["UPDATE", "NEW TABLE AS new_rows OLD TABLE AS old_rows"]]) {
      const name = `trg_org_change_${ev.toLowerCase()}`;
      if (have.has(`${t}.${name}`)) continue;
      await pool.query(`CREATE TRIGGER ${name} AFTER ${ev} ON "${t}" REFERENCING ${ref}
                          FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`);
    }
  }
  return plan.length;
}

// The stored answer's key: the route, its query string in a fixed order, and
// the person when the route's answer depends on who asks.
function keyFor(name, req, perUser) {
  const u = new URL(req.originalUrl, "http://x");
  const qs = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join("&");
  return `${name}|${perUser ? req.user.userId : "*"}|${u.pathname}?${qs}`;
}

const stats = { hits: 0, misses: 0, stores: 0, refreshes: 0, checks: 0, differences: 0 };

// The middleware, placed after requireAuth on a route whose answer is an
// org-wide figure. `perUser` (default true) keeps one stored answer per
// person, for routes whose answer reads the person or their role.
function cached(name, { perUser = true, when = null } = {}) {
  return async (req, res, next) => {
    try {
      if (off() || !req.user || !req.user.orgId || !deps) return next();
      if (when && !when(req)) return next();
      const orgId = req.user.orgId;
      const key = keyFor(name, req, perUser);
      const today = deps.orgToday(await deps.orgTz(orgId));   // ORG_TZ_SEAM_OK
      if (!req[FRESH]) {
        const hit = await query(
          `SELECT s.body FROM org_summary s
            WHERE s.org_key = ? AND s.key = ? AND s.computed_for = ?
              AND (s.valid_until IS NULL OR s.valid_until > NOW())
              AND NOT EXISTS (SELECT 1 FROM org_changes c WHERE c.org_key = s.org_key AND c.xid >= s.snap_xmin)`,
          [orgId, key, today]);
        if (hit.length) {
          stats.hits++;
          res.set("X-Org-Summary", "stored");
          res.type("application/json");
          return res.send(hit[0].body);
        }
      }
      stats.misses++;
      const [{ x }] = await query(`SELECT pg_snapshot_xmin(pg_current_snapshot())::text AS x`);
      const t0 = Date.now();
      const json = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode === 200 && !req[Symbol.for("steward.orgSummary.noStore")]) {
          const text = JSON.stringify(body);
          query(
            `INSERT INTO org_summary (org_key, key, path, user_id, body, snap_xmin, computed_for, ms, valid_until)
             VALUES (?,?,?,?,?,?::xid8,?,?,?)
             ON CONFLICT (org_key, key) DO UPDATE SET body = EXCLUDED.body, path = EXCLUDED.path, user_id = EXCLUDED.user_id,
               snap_xmin = EXCLUDED.snap_xmin, computed_for = EXCLUDED.computed_for, computed_at = NOW(), ms = EXCLUDED.ms,
               valid_until = EXCLUDED.valid_until
             WHERE org_summary.snap_xmin <= EXCLUDED.snap_xmin`,
            [orgId, key, req.originalUrl, perUser ? req.user.userId : null, text, x, today, Date.now() - t0,
             res.locals.orgSummaryValidUntil || null])
            .then(() => { stats.stores++; }).catch(e => console.error("[org-summary] store", e.message));
        }
        return json(body);
      };
      return next();
    } catch (e) {
      console.error("[org-summary]", e.message);
      return next();
    }
  };
}

// Recompute one stored answer through the route itself, as the person it was
// stored for (an internal token that never leaves this process).
async function computeFresh(row) {
  const userId = row.user_id || (await query(
    `SELECT id FROM users WHERE org_id = ? AND deactivated_at IS NULL ORDER BY (role = 'admin') DESC, created_at LIMIT 1`, [row.org_key]))[0]?.id;
  if (!userId) return null;
  const token = await deps.signInternalToken(userId);
  if (!token) return null;
  return inProcess.get(row.path, { headers: { authorization: `Bearer ${token}` }, mark: FRESH });
}

// THE QUEUE KEEPS IT CURRENT. After a change, every answer stored for the org
// today is recomputed off the request path, so the next visit finds it ready.
async function refreshOrg(orgId) {
  if (off() || !deps) return 0;
  const today = deps.orgToday(await deps.orgTz(orgId));   // ORG_TZ_SEAM_OK
  const rows = await query(
    `SELECT s.org_key, s.key, s.path, s.user_id FROM org_summary s
      WHERE s.org_key = ? AND s.computed_for = ?
        AND EXISTS (SELECT 1 FROM org_changes c WHERE c.org_key = s.org_key AND c.xid >= s.snap_xmin)`, [orgId, today]);
  for (const r of rows) { await computeFresh(r).catch(e => console.error("[org-summary] refresh", e.message)); stats.refreshes++; }
  return rows.length;
}
// Called by the after-change step: one waiting refresh per org, a moment
// later, so a burst of changes is one recompute.
function scheduleRefresh(orgId) {
  if (off() || !orgId) return;
  try {
    require("./jobQueue").enqueue({ name: "orgSummaryRefresh", orgId, key: `orgSummaryRefresh:${orgId}`, payload: { orgId }, runAfterMs: 2000 })
      .catch(e => console.error("[org-summary] enqueue", e.message));
  } catch (e) { console.error("[org-summary] enqueue", e.message); }
}

// THE NIGHTLY CHECK. Every stored answer that is still current is compared,
// byte for byte, with a fresh computation through the same route. A
// difference is logged with the org, the route and the first place the two
// differ; nothing is silently corrected without a line saying so.
async function checkAll({ log = console, orgId = null } = {}) {
  const rows = await query(`SELECT org_key, key, path, user_id, body, snap_xmin::text AS snap_xmin, computed_for, valid_until FROM org_summary
                             ${orgId ? "WHERE org_key = ?" : ""}`, orgId ? [orgId] : []);
  const out = { compared: 0, differences: [], skipped: 0 };
  for (const r of rows) {
    const today = deps.orgToday(await deps.orgTz(r.org_key));   // ORG_TZ_SEAM_OK
    const stillCurrent = r.computed_for === today && !(r.valid_until && new Date(r.valid_until) <= new Date()) && !(await query(
      `SELECT 1 FROM org_changes WHERE org_key = ? AND xid >= ?::xid8 LIMIT 1`, [r.org_key, r.snap_xmin])).length;
    if (!stillCurrent) { out.skipped++; continue; }
    const fresh = await computeFresh(r).catch(() => null);
    if (!fresh || fresh.status !== 200) { out.skipped++; continue; }
    // A write between the read above and the fresh computation makes the two
    // honestly different; only a difference with no change in between counts.
    const changed = (await query(`SELECT 1 FROM org_changes WHERE org_key = ? AND xid >= ?::xid8 LIMIT 1`, [r.org_key, r.snap_xmin])).length;
    if (changed) { out.skipped++; continue; }
    out.compared++; stats.checks++;
    if (fresh.body !== r.body) {
      let at = 0; while (at < r.body.length && r.body[at] === fresh.body[at]) at++;
      const d = { org: r.org_key, key: r.key, at, stored: r.body.slice(Math.max(0, at - 40), at + 60), fresh: fresh.body.slice(Math.max(0, at - 40), at + 60) };
      out.differences.push(d); stats.differences++;
      log.error(`[org-summary] DIFFERENCE ${r.org_key} ${r.key} at ${at}: stored …${d.stored}… fresh …${d.fresh}…`);
    }
  }
  if (orgId) return out;   // a one-org check (the suite) leaves housekeeping to the nightly run
  // Housekeeping: answers from an earlier day are never served again, and a
  // change row older than every stored answer's mark can no longer matter.
  await run(`DELETE FROM org_summary WHERE computed_for < ?`, [addDaysUtc(-2)]);
  await run(`DELETE FROM org_changes WHERE xid < COALESCE((SELECT MIN(snap_xmin) FROM org_summary), pg_snapshot_xmin(pg_current_snapshot()))`);
  log.log(`[org-summary] nightly check: ${out.compared} compared, ${out.differences.length} different, ${out.skipped} skipped`);
  return out;
}
function addDaysUtc(n) { const d = new Date(Date.now() + n * 86400000); return d.toISOString().slice(0, 10); }

module.exports = { configure, cached, installTriggers, refreshOrg, scheduleRefresh, checkAll, computeFresh, stats, FRESH, UNWATCHED };
