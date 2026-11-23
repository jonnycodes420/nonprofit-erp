// shared/numbers/isDonor.js · FLOWS-18 item 3 (W-1117-Fundraising-01). WHO IS A DONOR.
//
// Staging: Fundraising's lifetime was $6,756,201.84 and the Donors tab's
// $6,701,201.84. The $55,000 between them was exactly Meridian Foundation's
// gift: Meridian was on Everyone with Lifetime $55,000, but its stored roles
// said organisation only, so a Donors search for "Meridian" found nobody. The
// Donors tab read the stored role (shared/personType.js donorOnlySql); the
// money read the gifts.
//
// THE RULE, ONE PLACE: a person is a donor when their stored roles say so (a
// NULL roles column is a legacy row, a donor) OR when they have given, by the
// profile's rule (a counted gift on file, or a lifetime from the old system), read
// from the stored totals. The second half is applied ON
// READ: nothing stored changes, and a giver typed as a contact or an
// organisation keeps those roles and gains Donor beside them.
//
// The other direction is IMPORT-10's (donorType.js): the stored role is taken
// off someone who has not given. Together: on the Donors tab ⇔ has given, or
// was marked Donor and not yet settled.
"use strict";
const { HAS_GIVEN } = require("./donorLabel");

const STORED = (d) => `(${d}.person_types IS NULL OR ${d}.person_types @> '["donor"]'::jsonb)`;
// Has given, read from the stored totals: NUMBERS-6 made them the one writer's (donorTotals.js),
// guarded in CI, so the list reads no gift row per person (list5's probe budget: a gift probe for
// every contact on a 10,000-person list cost 6,400 probes). tests/lib/flows18Checks.js recounts
// the same people from the gift rows, so a stored total that drifted would show there.
const GAVE_STORED = (d) => `(COALESCE(${d}.gift_count, 0) > 0 OR COALESCE(${d}.total_giving, 0) > 0 OR COALESCE(${d}.imported_total, 0) > 0)`;
// DEFINE-1 item 4 (Jarvis, 22 Nov: "a never-given +Add person counts as a Donor"). A DONOR IS
// SOMEONE WHO HAS GIVEN. The stored role no longer makes a donor on its own: every surface that
// counts or lists Donors (the Donors tab and its count, All donors, the breakdowns) reads the gifts,
// through the stored totals. A person added as a Donor who has not given is a contact until they do.
// SQL: person `d` is a donor. `d` is the donors row's alias; with none, the table name.
const IS_DONOR = (d = "d") => { const a = d || "donors"; return GAVE_STORED(a); };

// The same rule on a row already read: { person_types, total_giving, gift_count, has_given? }.
// `has_given` (from HAS_GIVEN in the SELECT) wins when present; otherwise the stored totals.
function storedTypes(row) {
  const v = row && (row.person_types ?? row.personTypes);
  if (v == null) return null;
  const parsed = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  return Array.isArray(parsed) && parsed.length ? parsed : null;
}
function hasGivenRow(row) {
  if (!row) return false;
  if (row.has_given != null) return row.has_given === true || row.has_given === "t" || row.has_given === 1;
  return Number(row.total_giving) > 0 || Number(row.gift_count) > 0 || Number(row.imported_total) > 0;   // GAVE_STORED's three
}
// DEFINE-1: the same rule as IS_DONOR, on a row: has given.
function isDonorRow(row) {
  return hasGivenRow(row);
}
// The roles a screen shows for a row: Donor added on read for a giver.
function typesOnRead(row) {
  const t = storedTypes(row) || ["donor"];
  return !t.includes("donor") && hasGivenRow(row) ? ["donor", ...t] : t;
}

module.exports = { IS_DONOR, HAS_GIVEN, isDonorRow, typesOnRead, hasGivenRow };
