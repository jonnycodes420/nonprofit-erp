// COUNTS-1 · GET /donors/counts IN ONE NARROW PASS.
//
// How many people, and the three lapse counts the screens show (the Donors
// header, Re-engage's badge, Home): total, lapsed, lapsing, reengage. The
// rules are unchanged and are not written here: lapsed and lapsing are
// shared/numbers/lapse.js's (lapsedSql, lapsingSql), Re-engage is its
// reengageSql, and "has given" is donorStatus.statusSql's (a positive,
// non-credit gift dated on or before the org's today, on a live person).
//
// Why it is its own query. The route used to materialise the whole of
// statusSql (level, lifecycle, retained, first gift, pledge overdue, pledge
// held: a dozen aggregates over every gift, sorted to disk on a 25,000-person
// org) to read two of its columns. LOAD-1's load run had it at 17.6 s p95.
// These counts need one thing per giver: the latest positive gift, on file or
// imported (statusSql's LAST). The giving unit's linked people and pledges are
// read once for the org (lapse.js unitSetsSql), not once per person. And statusSql's lifecycle is 'lapsed' exactly
// when lapsedSql holds on that date: lapsed means the unit's last gift is on
// or before the day before the 12-month window, so the person has no gift in
// the window (statusSql's w0 is false) and the CASE falls through to its
// lapsed branch. The numbers are byte-identical (tests/lib/counts1Perf.js
// checks them against the rows).
"use strict";
const { query } = require("../../db");
const DS = require("../../donorStatus");
const L = require("../../shared/numbers/lapse");
const { NOT_CREDIT } = require("../../creditTypes");

const SET = "donors.org_id = ? AND donors.deleted_at IS NULL AND donors.erased_at IS NULL";   // TRUTH-2: an erased person is in no count

function countsSql(orgId, today, visible) {
  const v = visible && visible.sql ? visible : { sql: "", args: [] };   // ACCESS-2: a portfolio's people
  // statusSql's LAST, for its rows only: people with a positive gift on file.
  const LAST = "GREATEST(a.last_date, a.imp_last)";
  // The giving unit (linked people, pledges) read once for the org, set-wise.
  const U = L.unitSetsSql(orgId, today);
  const lapsed = L.lapsedSql(LAST, today, "a.donor_id", { linkedLast: "ua.linked_last", held: "ua.held" });
  const lapsing = L.lapsingSql(LAST, today, "a.donor_id", { linkedLast: "ua.linked_last", held: "ua.held" });
  const re = L.reengageSql("donors", today, { linkedLast: "ud.linked_last", held: "ud.held" });
  // Only a person whose OWN last gift is on or before the bound can be lapsed
  // or lapsing: the unit's last gift is never earlier than their own (lapse.js
  // unitLast is the later of the two). The CASE asks lapse.js's per-person
  // reads (the linked people, the pledges, the rhythm) only of them, and a
  // recent giver is answered from the date alone. The rule is lapse.js's.
  const b = require("../../lapseRule").bounds(today);
  const own = (expr) => `CASE WHEN (${expr})::date <= ?::date THEN`;
  const sql = `
    WITH ${U.with},
    a AS MATERIALIZED (
      SELECT g.donor_id, g.org_id, MAX(LEFT(g.date, 10)) AS last_date,
             MAX(LEFT(NULLIF(d.imported_last_gift_date, ''), 10)) AS imp_last
        FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id AND d.deleted_at IS NULL
       WHERE g.org_id = ? AND g.amount > 0 AND LEFT(g.date, 10) <= ? AND ${NOT_CREDIT("g")}
       GROUP BY g.donor_id, g.org_id),
    s AS MATERIALIZED (
      SELECT a.donor_id,
             ${own(LAST)} COALESCE(${lapsed.sql}, false) ELSE false END AS lapsed,
             ${own(LAST)} COALESCE(${lapsing.sql}, false) ELSE false END AS lapsing
        FROM a LEFT JOIN unit ua ON ua.donor_id = a.donor_id)
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s.lapsed)::int AS lapsed,
      COUNT(*) FILTER (WHERE s.lapsing)::int AS lapsing,
      COUNT(*) FILTER (WHERE ${own(L.LAST_ON_RECORD("donors"))} ${re.sql} ELSE false END)::int AS reengage
    FROM donors LEFT JOIN s ON s.donor_id = donors.id LEFT JOIN unit ud ON ud.donor_id = donors.id WHERE ${SET}${v.sql}`;
  return { sql, args: [...U.args, orgId, today, b.lapsedOnOrBefore, ...lapsed.args, b.lapsingOnOrBefore, ...lapsing.args, b.lapsedOnOrBefore, ...re.args, orgId, ...v.args] };
}

async function peopleCounts(orgId, visible) {
  const today = await DS.todayFor(orgId);
  const { sql, args } = countsSql(orgId, today, visible);
  const [r] = await query(sql, args);
  return r;
}

module.exports = { peopleCounts, countsSql };
