// server/donors/currentThrough.js · INTEGRITY-1 (W-1107-Donors-22X). CURRENT
// THROUGH SOMEONE ELSE, SAID SO.
//
// A person is Current when their giving unit gave in the last 12 months
// (shared/numbers/lapse.js: a spouse, a partner, or the organisation they
// give through or work at). The tag's sentence said "They gave in the last 12
// months" to someone who had not: a household member kept Current by the
// other's gift. Now, when their own last gift is older than the window and no
// pledge holds them, the sentence names who keeps them Current and how:
// "Current through Marlowe Charitable Trust (gives through)".
"use strict";

const L = require("../../shared/numbers/lapse");
const lapseRule = require("../../lapseRule");

const HOW = Object.freeze({ spouse: "household", partner: "household", owner: "gives through", works_at: "employer" });

// `row` is donorStatus.statusSql's row for the person. Returns null, or
// { name, how, sentence }.
async function currentThrough(query, orgId, donorId, row, today) {
  if (!row || row.lifecycle !== "current" || row.pledge_held) return null;
  const from = lapseRule.bounds(today).lapsingFrom;
  if (row.last_date && String(row.last_date).slice(0, 10) >= from) return null;   // they gave themselves
  const [l] = await query(
    `SELECT lk.name, lr.relationship_type AS type,
            GREATEST(NULLIF(LEFT(lk.last_gift_date, 10), ''), NULLIF(LEFT(lk.imported_last_gift_date, 10), '')) AS last
       FROM donor_relationships lr
       JOIN donors lk ON lk.org_id = lr.org_id AND lk.deleted_at IS NULL
                     AND lk.id = CASE WHEN lr.donor_id_a = ? THEN lr.donor_id_b ELSE lr.donor_id_a END
      WHERE lr.org_id = ? AND (lr.donor_id_a = ? OR lr.donor_id_b = ?) AND lr.relationship_type = ANY(?::text[])
      ORDER BY 3 DESC NULLS LAST, lk.name LIMIT 1`, [donorId, orgId, donorId, donorId, [...L.UNIT_LINK_TYPES]]);
  if (!l || !l.last || String(l.last) < from) return null;
  const how = HOW[l.type] || "linked";
  return { name: l.name, how,
    sentence: `Current through ${l.name} (${how}). They have not given in the last 12 months themselves; ${l.name} has, and one giving unit counts as one.` };
}

module.exports = { currentThrough, HOW };
