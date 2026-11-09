// server/reports/lostReport.js · COUNTS-1. THE REPORT "LOST: OVER 24 MONTHS".
//
// It was a builder filter, "last gift date before today less 730 days, not
// deceased": the stored last gift only, no imported last gift, no pledge
// holding them, no giving unit, and do-not-contact people in. Re-engage said
// 330 lapsed beside it at 95, with no words saying they measured different
// things. Now the report lists exactly Re-engage's Lost & Found people, by the
// one rule (shared/numbers/lapse.js lostSql: lapsed and askable by Re-engage's
// rule, the unit's last gift before today less 24 months), with the columns
// the builder report had, in the builder's shape.
"use strict";
const { query } = require("../../db");
const LAPSE = require("../../shared/numbers/lapse");
const DS = require("../../donorStatus");
const AT_RISK = require("../../shared/numbers/atRisk");   // TRUTH-4: one at-risk figure with Lost & Found

const cents = v => Math.round(Number(v || 0) * 100);

async function lostReport(orgId) {
  const today = await DS.todayFor(orgId);
  const lost = LAPSE.lostSql("d", today);
  const rows = await query(
    `SELECT d.id, d.name, ${LAPSE.LAST_ON_RECORD("d")} AS last_gift, COALESCE(d.last_gift_amount, 0) AS last_amount,
            COALESCE(d.total_giving, 0) AS lifetime, d.email, ${AT_RISK.LAST_YEAR_OF_GIVING("d")} AS last_year
       FROM donors d
      WHERE d.org_id = ? AND d.deleted_at IS NULL AND ${lost.sql}
      ORDER BY COALESCE(d.total_giving, 0) DESC, d.id`, [orgId, ...lost.args]);
  return {
    columns: [{ key: "c0", label: "Name", type: "text" }, { key: "c1", label: "Last gift date", type: "date" },
      { key: "c2", label: "Last gift amount", type: "money" }, { key: "c5", label: AT_RISK.LABEL, type: "money" },
      { key: "c3", label: "Lifetime giving", type: "money" }, { key: "c4", label: "Email", type: "text" }],
    rows: rows.map(r => ({ c0: r.name, c1: r.last_gift, c2: cents(r.last_amount) / 100, c5: cents(r.last_year) / 100, c3: cents(r.lifetime) / 100, c4: r.email, _pid: r.id })),
    // TRUTH-4: the money at risk is the last year of giving (atRisk.js), as Lost & Found's tile; lifetime beside it, labeled.
    totals: { count: rows.length, sums: [{ key: "lastYear", label: `At risk: ${AT_RISK.LABEL.toLowerCase()}`, cents: rows.reduce((s, r) => s + cents(r.last_year), 0) },
      { key: "lifetime", label: "Lifetime giving", cents: rows.reduce((s, r) => s + cents(r.lifetime), 0) }] },
    definition: `Lost: no gift in over 24 months, after giving before. The same people as Re-engage's Lost & Found: anyone a pledge holds, and anyone marked deceased, do not contact or do not solicit, is left out. ${AT_RISK.SENTENCE}`,
  };
}

module.exports = { lostReport };
