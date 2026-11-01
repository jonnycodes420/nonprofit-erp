// shared/numbers/lifetime.js · NUMBERS-3. A PERSON'S LIFETIME GIVING.
//
// The imported total (the old system's figure, donors.imported_*, NUMBERS-2)
// plus every gift in Steward dated after the day it covers (an undated gift is
// always after it), refunds taken off, credit rows out (money.js). It is kept
// on the person as donors.total_giving by donorSummary.js, recomputed on every
// write; LIFETIME() is the same figure computed live, for a face that cannot
// read the stored column (the donor portal, the account page, merge fields).
// The profile's Lifetime opens its rows through the figure source
// `donor-lifetime`, which is this rule too.
"use strict";
const { MONEY } = require("./money");

// A gift on file the imported total does not already cover (donorSummary.js).
const AFTER_IMPORT = (g = "g", d = "d") => `(${d}.imported_through IS NULL OR ${g}.date IS NULL OR ${g}.date > ${d}.imported_through)`;

// SQL: person `d`'s lifetime giving, in dollars (numeric).
const LIFETIME = (d = "d") => `(COALESCE(${d}.imported_total, 0) + COALESCE((SELECT SUM(lg.amount) FROM gifts lg
    WHERE lg.org_id = ${d}.org_id AND lg.donor_id = ${d}.id AND ${MONEY("lg")} AND ${AFTER_IMPORT("lg", d)}), 0))`;

// Lifetime for several people, in cents: Map id -> cents.
async function lifetimeCents(query, orgId, ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(`SELECT d.id, ROUND(${LIFETIME("d")} * 100)::bigint AS cents FROM donors d
                             WHERE d.org_id = ? AND d.id = ANY(?::text[])`, [orgId, ids]);
  return new Map(rows.map(r => [r.id, Number(r.cents)]));
}

module.exports = { LIFETIME, AFTER_IMPORT, lifetimeCents };
