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
// FEEL-1: an undated gift from the import that stated the total is inside it
// (donorSummary.js has the same rule): dating it later never moves Lifetime.
const AFTER_IMPORT = (g = "g", d = "d") => `(${d}.imported_through IS NULL OR (${g}.date IS NULL AND (${d}.imported_import_id IS NULL OR ${g}.import_id IS DISTINCT FROM ${d}.imported_import_id)) OR ${g}.date > ${d}.imported_through)`;

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

// MOPUP-2: AFTER_IMPORT for rows already read (the move deck): `gift` has
// date (YYYY-MM-DD or empty), import_id and amount_cents; `person` its
// donors.imported_through and imported_import_id. The cents given since.
function afterImport(gift, person) {
  const p = person || {};
  if (!p.imported_through) return true;
  if (!gift.date) return !p.imported_import_id || gift.import_id !== p.imported_import_id;
  return String(gift.date).slice(0, 10) > String(p.imported_through).slice(0, 10);
}
const sinceImportCents = (gifts, personOf) => (gifts || []).filter(g => afterImport(g, personOf(g))).reduce((n, g) => n + (Number(g.amount_cents) || 0), 0);

module.exports = { LIFETIME, AFTER_IMPORT, lifetimeCents, afterImport, sinceImportCents };
