// shared/numbers/tags.js · NUMBERS-4. MAJOR, AND EVERY GIVING-LEVEL TAG, ONCE.
//
// MAP-1 §2.7 found four "major" rules: the tag (last 12 months against the
// org's Giving levels), the Insights ladder (last 12 months OR any single gift
// against a separate line nobody could set, else the smaller of $5,000 and the
// top 5% of households' lifetimes), and two "top tenth" percentiles copied
// into three files. Now:
//   · a person's giving level is what they gave in the last 12 months (net of
//     refunds, credits out) against the org's own cut points, Settings,
//     Giving levels (defaults $1,000 and $10,000): General, Mid or Major. The
//     tag, the Donors filters, groups, the Insights ladder and its Major tab,
//     Home's moves and Ask all read levelOf / LEVEL_SQL with cutsFor's cuts,
//     so a person tagged Major is on the Major rung and the reverse;
//   · "top tenth" is not major: it is the tenth of givers with the highest
//     lifetime, said as such ("Top tenth of your donors by lifetime giving"),
//     and its line is TOP_TENTH_SQL, once.
// The lifecycle tags (New, Current, Recaptured, Lapsed), Retained, Lapsing and
// Pledge payment overdue are donorStatus.statusSql, which reads lapse.js and
// firstGift.js; the level is this file.
"use strict";

const DEFAULT_CUTS = Object.freeze({ midCents: 100000, majorCents: 1000000 });

// The org's cut points from its row ({ giving_level_mid_cents, giving_level_major_cents }).
function cutsOf(org) {
  const o = org || {};
  return {
    midCents: o.giving_level_mid_cents != null ? Number(o.giving_level_mid_cents) : DEFAULT_CUTS.midCents,
    majorCents: o.giving_level_major_cents != null ? Number(o.giving_level_major_cents) : DEFAULT_CUTS.majorCents,
  };
}
// The level for a last-12-months total in cents.
function levelOf(last12Cents, cuts) {
  const c = Math.round(Number(last12Cents) || 0), k = cuts || DEFAULT_CUTS;
  return c >= k.majorCents ? "major" : c >= k.midCents ? "mid" : "general";
}
const isMajor = (last12Cents, cuts) => levelOf(last12Cents, cuts) === "major";
// The same in SQL over a dollars expression; args are [majorCents, midCents].
const LEVEL_SQL = last12Dollars => `CASE WHEN ROUND((${last12Dollars}) * 100) >= ? THEN 'major' WHEN ROUND((${last12Dollars}) * 100) >= ? THEN 'mid' ELSE 'general' END`;
const levelArgs = cuts => [(cuts || DEFAULT_CUTS).majorCents, (cuts || DEFAULT_CUTS).midCents];

// The top tenth by lifetime: the lifetime giving above which a giver is in
// the org's top tenth (the 90th percentile of the stored lifetime of people
// who have given). One `?`: the org.
const TOP_TENTH_SQL = `SELECT percentile_cont(0.9) WITHIN GROUP (ORDER BY total_giving) AS p90
    FROM donors WHERE org_id = ? AND deleted_at IS NULL AND total_giving > 0`;

module.exports = { DEFAULT_CUTS, cutsOf, levelOf, isMajor, LEVEL_SQL, levelArgs, TOP_TENTH_SQL };
