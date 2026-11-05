// server/groups/starterReport.js · COUNTS-1. A STARTER THAT COUNTS DIFFERENTLY
// FROM THE REPORT OF THE SAME NAME SAYS SO, WITH THE REPORT'S NUMBER.
//
// The SYBUNT starter said 243 people while the SYBUNT report said 552. Both
// are right and neither said why: Reports' SYBUNT (server/reports/handlers.js
// buntPredicate) is everyone who gave before this fiscal year and not in it,
// which holds every LYBUNT person too; the starter leaves out anyone who gave
// last year (they are the LYBUNT starter) and anyone who may not be asked.
// The starter keeps its rule and carries the report's count, from the same
// predicate the report runs, and the sentence that joins the two.
"use strict";
const { query } = require("../../db");

async function sybuntReportLine(orgId) {
  const RH = require("../../routes/crm").reportHooks;
  const { cur, prior } = await RH.yearWindows(orgId);
  const b = RH.buntPredicate("sybunt", cur, prior, "d");
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM donors d WHERE d.org_id = ? AND d.deleted_at IS NULL AND ${b.sql}`, [orgId, ...b.args]);
  const n = r ? r.n : 0;
  return {
    count: n,
    sentence: `The SYBUNT report counts ${n.toLocaleString("en-US")} ${n === 1 ? "person" : "people"}: everyone who gave before this fiscal year and not in it, including those who gave last year. This list leaves out last year's givers (they are the LYBUNT list) and anyone who may not be asked.`,
  };
}

module.exports = { sybuntReportLine };
