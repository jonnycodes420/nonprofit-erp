// shared/numbers/donorType.js · IMPORT-10 item 8. A DONOR IS SOMEONE WHO HAS GIVEN.
//
// 12 Nov: a customer's Directory said Donors 6,445 and Contacts 0, and 3,592 of
// the 6,445 had no gift at all. The Directory counts the stored role
// (shared/personType.js donorOnlySql: person_types holds "donor"), and two
// import paths stored "donor" for every row whatever it held
// (server/imports/combined.js and server/imports/routes.js: "nothing stated ⇒ a
// donor"), as does the column's default. The spreadsheet import was already
// right: no gift, a contact.
//
// THE RULE, ONE PLACE: the stored "donor" role means the person has given, by
// the profile's rule (donorLabel.js HAS_GIVEN: a gift on file, or a lifetime
// above zero from the old system). A gift adds the role (recordGifts.js, the
// one gift path); this takes it away from someone it was written on who has
// not given: they keep their other roles, or become a contact ("other").
// Imports apply it to the people a run created; scripts/ops/import10-donor-
// roles.js applies it to the rows already stored, dry run first.
"use strict";
const { HAS_GIVEN } = require("./donorLabel");

const DONOR = `'["donor"]'::jsonb`;
// SQL: person `d` is marked a donor and has not given.
const MARKED_NOT_GIVEN = (d = "d") => `((${d}.person_types IS NULL OR ${d}.person_types @> ${DONOR}) AND NOT ${HAS_GIVEN(d)})`;
// SQL: the roles person `d` keeps once "donor" comes off ("other" when none is left).
const WITHOUT_DONOR = (d = "d") => `(CASE WHEN COALESCE(${d}.person_types, ${DONOR}) - 'donor' = '[]'::jsonb THEN '["other"]'::jsonb
                                         ELSE COALESCE(${d}.person_types, ${DONOR}) - 'donor' END)`;

// The people in `ids` (one org) marked donor who have not given lose the role.
// `exec(sql, params)` is a query or a transaction's query; returns how many.
async function settleDonorRoles(exec, orgId, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return 0;
  const rows = await exec(`UPDATE donors d SET person_types = ${WITHOUT_DONOR("d")}, updated_at = NOW()
                            WHERE d.org_id = ? AND d.id = ANY(?::text[]) AND ${MARKED_NOT_GIVEN("d")} RETURNING d.id`, [orgId, list]);
  return Array.isArray(rows) ? rows.length : (rows && rows.rowCount) || 0;
}

module.exports = { MARKED_NOT_GIVEN, WITHOUT_DONOR, settleDonorRoles };
