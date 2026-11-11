// server/reports/storedReports.js · REPORTS-SPEED-1. RETENTION, ANNUAL AND
// SYBUNT, READ FROM A STORED PER-ORG ANSWER.
//
// Each of the three is one grouped pass over every gift the org has, every
// time it is asked (SCALE-3: 1.2 to 2.5 s p95 under the nightly load). Their
// answers now live in the per-org store SCALE-2 built for Home (orgSummary.js,
// org_summary): served while nothing it reads has changed, recomputed on read
// otherwise, and refreshed off the request path by the after-change step
// (orgSummaryRefresh, one per org a moment after a change).
//
// WHAT "NOTHING IT READS HAS CHANGED" MEANS. SCALE-3 tried the store and found
// it worse: every write in the org (a logged call, a score, a task) threw the
// answer away, and the worker recomputed it after each. Now a stored answer
// names the tables it reads (DEPS), and only a change row from one of them
// makes it stale. `donors` is written by nearly every action (a call rescores
// the person), so the reports depend on `donors.people` instead: a change row
// written only when a donor row changes in a column other than the few that
// background work keeps rewriting and none of the three reads (PEOPLE_EXCEPT).
// Any column added to donors later counts, by default.
//
// WHICH ANSWERS ARE STORED. The screen's own asks: Retention with a year mode,
// Annual and SYBUNT for a year near today with a year mode. A fund or campaign
// filter, a date range, an older year or a file computes live, as before.
//
// THE NIGHTLY PASS (storedReportsNightly). For every org with people: each
// common ask is recomputed through the route, compared byte for byte with the
// stored answer when that one was still current (a difference is logged with
// the org, the ask and the first place they differ), and the fresh answer is
// stored, so the morning's first visit finds it ready.
"use strict";

const KEYS = new Set(["retention", "annual", "sybunt"]);
// The tables the three read (captured from the SQL each one sends: gifts and
// orgs for all three; Annual's funds, fund lines and campaigns; SYBUNT's
// households, relationships and the import-in-progress note), plus donors.people.
const DEPS = ["gifts", "orgs", "donors.people", "campaigns", "fin_funds", "gift_fund_lines", "households",
  "donor_relationships", "import_recent_jobs", "pledges", "soft_credits"];
// Donor columns that background work rewrites and none of the three reads:
// the score (every call and gift), the stage suggestion, geocoding and photo
// fetching, and the row's own timestamp.
const PEOPLE_EXCEPT = ["wealth_score", "capacity_tier", "score_confidence", "score_last_updated", "score_rationale",
  "updated_at", "suggested_stage", "geocode_key", "geocode_provider", "geocode_status", "geocoded_at", "latitude", "longitude",
  "photo_fetch_error", "photo_fetch_status"];
const ALLOWED_QUERY = new Set(["yearMode", "year"]);

// Is this request one of the stored asks? `nowYear` is the server's calendar
// year; a year one either side of it covers every org's fiscal labelling.
function isStoredAsk(req, nowYear = new Date().getUTCFullYear()) {
  const key = req.params && req.params.key;
  if (!KEYS.has(key)) return false;
  const q = req.query || {};
  for (const k of Object.keys(q)) if (!ALLOWED_QUERY.has(k)) return false;
  if (q.yearMode !== undefined && !["fiscal", "calendar"].includes(String(q.yearMode))) return false;
  if (q.year !== undefined) {
    if (key === "retention" || !/^\d{4}$/.test(String(q.year))) return false;
    const y = Number(q.year);
    if (y < nowYear - 1 || y > nowYear + 1) return false;
  }
  return true;
}

// The donors.people change row: one per org per statement, only for rows that
// changed outside PEOPLE_EXCEPT (an insert or a delete always counts). Set-wise
// from the transition tables, like SCALE-2's own trigger.
async function installPeopleTrigger(pool) {
  const except = PEOPLE_EXCEPT.map(c => `'${c}'`).join(",");
  await pool.query(`CREATE OR REPLACE FUNCTION steward_note_people_change() RETURNS TRIGGER AS $fn$
    BEGIN
      IF TG_OP = 'INSERT' THEN
        INSERT INTO org_changes (org_key, tbl) SELECT DISTINCT org_id::text, 'donors.people' FROM new_rows WHERE org_id IS NOT NULL;
      ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO org_changes (org_key, tbl) SELECT DISTINCT org_id::text, 'donors.people' FROM old_rows WHERE org_id IS NOT NULL;
      ELSE
        INSERT INTO org_changes (org_key, tbl)
          SELECT DISTINCT o, 'donors.people' FROM (
            SELECT n.org_id::text AS o FROM new_rows n LEFT JOIN old_rows d ON d.id = n.id
             WHERE d.id IS NULL OR (to_jsonb(n) - ARRAY[${except}]) IS DISTINCT FROM (to_jsonb(d) - ARRAY[${except}])
            UNION SELECT d.org_id::text FROM old_rows d LEFT JOIN new_rows n ON n.id = d.id WHERE n.id IS NULL
          ) x WHERE o IS NOT NULL;
      END IF;
      RETURN NULL;
    END; $fn$ LANGUAGE plpgsql`);
  const have = new Set((await pool.query(
    `SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'donors' AND t.tgname LIKE 'trg_people_change_%'`)).rows.map(r => r.tgname));
  for (const [ev, ref] of [["INSERT", "NEW TABLE AS new_rows"], ["DELETE", "OLD TABLE AS old_rows"],
                           ["UPDATE", "NEW TABLE AS new_rows OLD TABLE AS old_rows"]]) {
    const name = `trg_people_change_${ev.toLowerCase()}`;
    if (have.has(name)) continue;
    await pool.query(`CREATE TRIGGER ${name} AFTER ${ev} ON donors REFERENCING ${ref} FOR EACH STATEMENT EXECUTE FUNCTION steward_note_people_change()`);
  }
}

// The asks the screen makes for an org today: Retention in both year modes,
// Annual and SYBUNT for this year and last in the org's own mode.
function commonPaths({ fiscalYear, calendarYear }) {
  const out = [];
  for (const m of ["fiscal", "calendar"]) out.push(`/reports/retention?yearMode=${m}`);
  for (const k of ["annual", "sybunt"]) {
    for (const [m, y] of [["fiscal", fiscalYear], ["calendar", calendarYear]]) {
      out.push(`/reports/${k}?year=${y}&yearMode=${m}`, `/reports/${k}?year=${y - 1}&yearMode=${m}`);
    }
  }
  return out;
}

// The stored row's key for a path, as orgSummary.keyFor builds it (perUser false).
function keyForPath(path) {
  const u = new URL(path, "http://x");
  const qs = [...u.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${v}`).join("&");
  return `report|*|${u.pathname}?${qs}`;
}

async function nightly({ log = console, orgId = null } = {}) {
  const OS = require("../../orgSummary");
  const { query } = require("../../db");
  const { orgReportYear } = require("../../orgTime");
  const orgs = orgId ? [{ id: orgId }] : await query(
    `SELECT o.id FROM orgs o WHERE EXISTS (SELECT 1 FROM donors d WHERE d.org_id = o.id AND d.deleted_at IS NULL) ORDER BY o.id`);
  const out = { orgs: 0, compared: 0, stored: 0, differences: [] };
  for (const o of orgs) {
    try {
      const [org] = await query(`SELECT * FROM orgs WHERE id = ?`, [o.id]);
      if (!org) continue;
      // The years the route itself calls current (orgTime.orgReportYear, the org's zone and fiscal start).
      const years = { fiscalYear: orgReportYear(org, "fiscal"), calendarYear: orgReportYear(org, "calendar") };
      out.orgs++;
      for (const path of commonPaths(years)) {
        const key = keyForPath(path);
        const [had] = await query(`SELECT org_key, key, path, user_id, body, snap_xmin::text AS snap_xmin, deps, computed_for FROM org_summary WHERE org_key = ? AND key = ?`, [o.id, key]);
        const fresh = await OS.computeFresh({ org_key: o.id, path, user_id: null }).catch(() => null);
        if (!fresh || fresh.status !== 200) continue;
        out.stored++;
        // Compared only with an answer stored for the same org day that nothing has changed since.
        const [now] = await query(`SELECT computed_for FROM org_summary WHERE org_key = ? AND key = ?`, [o.id, key]);
        if (!had || !now || had.computed_for !== now.computed_for || (await OS.changedSince(had))) continue;
        out.compared++;
        if (fresh.body !== had.body) {
          let at = 0; while (at < had.body.length && had.body[at] === fresh.body[at]) at++;
          const d = { org: o.id, path, at, stored: had.body.slice(Math.max(0, at - 40), at + 60), fresh: fresh.body.slice(Math.max(0, at - 40), at + 60) };
          out.differences.push(d);
          log.error(`[stored-reports] DIFFERENCE ${o.id} ${path} at ${at}: stored …${d.stored}… fresh …${d.fresh}…`);
        }
      }
    } catch (e) { log.error(`[stored-reports] ${o.id}: ${e.message}`); }
  }
  log.log(`[stored-reports] nightly: ${out.orgs} orgs, ${out.stored} answers stored, ${out.compared} compared, ${out.differences.length} different`);
  return out;
}

module.exports = { KEYS, DEPS, PEOPLE_EXCEPT, isStoredAsk, installPeopleTrigger, commonPaths, keyForPath, nightly };
