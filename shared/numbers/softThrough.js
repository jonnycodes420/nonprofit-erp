// shared/numbers/softThrough.js · TRUTH-5. WHAT WAS GIVEN THROUGH A RECORD.
//
// The fleet (W-1109-Finance-37X) opened Marlowe Charitable Trust and read its
// linked people each with their whole lifetime (summing to $105,503) beside
// the trust's own $4,682. A person's lifetime is theirs, not the trust's. What
// went THROUGH the trust is soft credit: the part of the trust's own gifts
// credited to each person (gift_soft_credits on a gift whose donor is the
// trust). The Through list says that, per person, and its line:
//   "$4,682 given through the trust, by 3 people"
// where $4,682 is the trust's money that carries a soft credit (each gift once)
// and 3 is the people credited. A refund or a credit row is not money given
// (money.js MONEY); a deleted person is not listed.
"use strict";
const { MONEY } = require("./money");

// Per person: the soft credit they hold on `orgDonorId`'s gifts. Map id -> cents.
async function throughByPerson(query, orgId, orgDonorId, personIds = null) {
  const rows = await query(
    `SELECT sc.donor_id, COALESCE(SUM(ROUND(sc.amount * 100)), 0)::bigint AS cents
       FROM gift_soft_credits sc
       JOIN gifts g ON g.id = sc.gift_id AND g.org_id = sc.org_id
       JOIN donors p ON p.id = sc.donor_id AND p.org_id = sc.org_id AND p.deleted_at IS NULL
      WHERE sc.org_id = ? AND g.donor_id = ? AND ${MONEY("g")} AND g.amount > 0${personIds ? " AND sc.donor_id = ANY(?::text[])" : ""}
      GROUP BY sc.donor_id`, personIds ? [orgId, orgDonorId, personIds] : [orgId, orgDonorId]);
  return new Map(rows.map(r => [r.donor_id, Number(r.cents) || 0]));
}
// The line: the record's own gifts that carry a soft credit, each gift once, and how many people.
async function throughSummary(query, orgId, orgDonorId) {
  const [r] = await query(
    `SELECT COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents,
            (SELECT COUNT(DISTINCT sc2.donor_id)::int FROM gift_soft_credits sc2 JOIN gifts g2 ON g2.id = sc2.gift_id AND g2.org_id = sc2.org_id
               JOIN donors p2 ON p2.id = sc2.donor_id AND p2.org_id = sc2.org_id AND p2.deleted_at IS NULL
              WHERE sc2.org_id = ? AND g2.donor_id = ? AND ${MONEY("g2")} AND g2.amount > 0) AS people
       FROM gifts g
      WHERE g.org_id = ? AND g.donor_id = ? AND ${MONEY("g")} AND g.amount > 0
        AND EXISTS (SELECT 1 FROM gift_soft_credits sc WHERE sc.gift_id = g.id AND sc.org_id = g.org_id)`, [orgId, orgDonorId, orgId, orgDonorId]);
  return { cents: Number(r && r.cents) || 0, people: Number(r && r.people) || 0 };
}
const usd = c => "$" + (c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
const summaryWords = (s, name = "this record") => (s.people
  ? `${usd(s.cents)} given through ${name}, by ${s.people} ${s.people === 1 ? "person" : "people"}`
  : `Nothing given through ${name} is soft-credited to anyone yet`);

const SENTENCE = "Given through: the part of this record's own gifts soft-credited to each person. A person's lifetime giving is theirs, never added in here.";

module.exports = { throughByPerson, throughSummary, summaryWords, SENTENCE };
