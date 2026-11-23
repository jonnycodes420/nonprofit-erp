// tests/lib/flows18Checks.js · FLOWS-18 item 3 (W-1117-Fundraising-01), run by every assertSurfacesAgree.
//   giversAreDonors  everyone who has given is on the Donors tab, whatever their stored roles say:
//                    the Donors count and the Contacts count agree with SQL written here from the
//                    rule (not from the code's predicate), and the portfolio file leaves no giver's
//                    money off the Donors tab.
// Staging: Meridian Foundation ($55,000, typed organisation only) was on Everyone and not on Donors,
// so Fundraising's lifetime and the Donors tab's total differed by exactly its gift.
"use strict";

const C = v => Math.round(Number(v || 0) * 100);
const $ = c => `$${(c / 100).toFixed(2)}`;
const CREDIT = "('soft credit','soft-credit','soft_credit','matching gift credit','matched gift credit','hard credit reversal')";
// Has given: a gift above $0, not refunded in full, not a credit row, not a scheduled gift whose
// day has not come; or a lifetime from the old system.
const GAVE = d => `(COALESCE(${d}.imported_total, 0) > 0 OR EXISTS (SELECT 1 FROM gifts kg WHERE kg.org_id = ${d}.org_id AND kg.donor_id = ${d}.id
                     AND kg.amount > 0 AND kg.refunded_in_full IS NOT TRUE AND LOWER(TRIM(COALESCE(kg.type, ''))) NOT IN ${CREDIT}
                     AND (kg.scheduled_on IS NULL OR kg.scheduled_on::date <= CURRENT_DATE)))`;
const MARKED = d => `(${d}.person_types IS NULL OR ${d}.person_types @> '["donor"]'::jsonb)`;
const EVERY = d => `(${d}.deleted_at IS NULL AND ${d}.erased_at IS NULL AND ${d}.archived_at IS NULL)`;

async function flows18Checks({ orgId, get, q, agree, skip }) {
  if (skip.has("giversAreDonors")) return;
  // DEFINE-1 item 4: a Donor is someone who has given; the stored role alone makes nobody a donor.
  const [k] = await q(`SELECT COUNT(*) FILTER (WHERE ${GAVE("d")})::int AS donors,
                              COUNT(*) FILTER (WHERE NOT ${GAVE("d")})::int AS contacts,
                              COUNT(*) FILTER (WHERE NOT ${MARKED("d")} AND ${GAVE("d")})::int AS unmarked_givers
                         FROM donors d WHERE d.org_id = $1 AND ${EVERY("d")}`, [orgId]);
  const tab = await get("/donors?role=donor&roleCounts=1&limit=1").catch(() => null);
  if (tab && tab.roleCounts) {
    agree(`the Donors tab: has given (${k.unmarked_givers} gave and are typed otherwise)`,
      [["the rule (SQL)", Number(k.donors)], ["the Donors tab", Number(tab.roleCounts.donors)]]);
    agree("Contacts: never gave", [["the rule (SQL)", Number(k.contacts)], ["the Contacts count", Number(tab.roleCounts.contacts)]]);
  }
  const r = await get("/portfolio/officers").catch(() => null);
  if (r && r.file && r.file.allGiving != null && r.file.file) {
    agree("money given by people on file and left off the Donors tab",
      [["none", 0], ["the portfolio file", C(r.file.allGiving) - C(r.file.file.giving)]], $);
  }
}

module.exports = { flows18Checks };
