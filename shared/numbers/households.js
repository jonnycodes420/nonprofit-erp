// shared/numbers/households.js · NUMBERS-4. PEOPLE AND HOUSEHOLDS, COUNTED ONCE.
//
// MAP-1 §2.11 found 27 hand-written people counts on four different filters
// and 13 household counts with no shared function. The words are
// ARCHITECTURE.md's: a household is counted once where the screen says
// households, and its people are counted where it says people.
//   A person     a row in `donors` that is not deleted and not sample data
//                (TRUTH-1's people). Organisations and non-donor people are
//                people too (one person record).
//   A household  a `households` row with at least one such person in it. A
//                household whose people are all deleted is not one.
//   A giving unit (a party) is a household once, or a person on their own:
//                EVENTS-3's grouping (events.js PARTY), which Insights' units
//                and an event's guest list both read.
"use strict";
const { LIVE } = require("./money");

// SQL: `d` is a person who counts.
const PERSON = (d = "d") => `(${LIVE(d)} AND ${d}.is_sample IS NOT TRUE)`;
// SQL: the giving unit `d` belongs to (EVENTS-3: a household once).
const UNIT = (d = "d") => `COALESCE(${d}.household_id, ${d}.id)`;

// One statement: people, households and giving units in the org. `where` is
// an optional extra condition on `d` (with its own args).
const COUNTS_SQL = (where = "") => `SELECT COUNT(*)::int AS people,
         COUNT(DISTINCT d.household_id)::int AS households,
         COUNT(DISTINCT ${UNIT("d")})::int AS units
    FROM donors d WHERE d.org_id = ? AND ${PERSON("d")}${where ? ` AND (${where})` : ""}`;
async function counts(query, orgId, { where = "", args = [] } = {}) {
  const [r] = await query(COUNTS_SQL(where), [orgId, ...args]);
  return { people: r ? Number(r.people) : 0, households: r ? Number(r.households) : 0, units: r ? Number(r.units) : 0 };
}

// The same over rows already read ([{ id, household_id, deleted_at?, is_sample? }]).
function countsOf(rows) {
  const live = (rows || []).filter(d => !d.deleted_at && d.is_sample !== true);
  return {
    people: live.length,
    households: new Set(live.map(d => d.household_id).filter(Boolean)).size,
    units: new Set(live.map(d => d.household_id || d.id)).size,
  };
}

// The words a screen prints beside the counts.
const WORDS = Object.freeze({
  people: "People are everyone in your records who is not deleted and not sample data: donors, organizations and other people.",
  households: "Households are counted once, however many of their people are here; a household whose people are all deleted is not counted.",
});

module.exports = { PERSON, UNIT, COUNTS_SQL, counts, countsOf, WORDS };
