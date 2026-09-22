// shared/personType.js — BUILD-94 Part 2. PEOPLE WHO ARE NOT DONORS.
//
// Until this build, every person in Steward was a donor. Allie Barnett pays
// Mailchimp over $100 a month and cannot leave it, because her volunteers,
// staff and board live only there. They have to live here, beside her donors,
// in one list — and they must be invisible to every number that means money.
//
// FOUR TYPES, AND A PERSON CAN BE MORE THAN ONE. A volunteer who gives is a
// volunteer AND a donor, on ONE record: the same person twice is the thing a
// CRM exists to prevent, so becoming a donor ADDS a type, it never forks a row.
//
// THE RULE THAT IS THE POINT OF THE PART: a person who is not a Donor is
// excluded from Drift, retention, giving totals, the Board dashboard,
// receipts, Recurring, lapsed logic, the 199-dot picture, MRR, and any count
// that reads "donors". One predicate, below, is how that is enforced — and it
// is deliberately NULL-tolerant, because a legacy row that predates the column
// is a donor and must read as one even if a migration has not touched it yet.
//
// Pure. No database, no express — the SQL fragment is a string the server
// splices into a WHERE clause, and the suite unit-tests the shape directly.

export const PERSON_TYPES = [
  { key: "donor",       label: "Donor",           plural: "Donors" },
  { key: "volunteer",   label: "Volunteer",       plural: "Volunteers" },
  { key: "staff_board", label: "Staff and board", plural: "Staff and board" },
  { key: "other",       label: "Other",           plural: "Other" },
];
export const PERSON_TYPE_KEYS = PERSON_TYPES.map(t => t.key);
const KEYSET = new Set(PERSON_TYPE_KEYS);

export const DONOR_TYPE = "donor";

// Normalise anything that arrives claiming to be a type list. An unknown key
// is DROPPED, never stored: a mistyped or hostile payload cannot invent a
// fifth type and quietly create a population nothing filters on.
// Empty after normalising ⇒ ["other"]: a person with no type at all is a row
// nothing can reason about, and "Other" is the honest answer, not "Donor"
// (calling a Mailchimp contact a donor is how a giving total goes wrong).
export function normalizeTypes(input) {
  const raw = Array.isArray(input) ? input
    : (typeof input === "string" && input.trim() ? [input] : []);
  const seen = new Set();
  for (const v of raw) {
    const k = String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (KEYSET.has(k)) seen.add(k);
  }
  if (!seen.size) return ["other"];
  // Stored in the canonical order so two equal sets compare equal as JSON.
  return PERSON_TYPE_KEYS.filter(k => seen.has(k));
}

// A NULL column is a legacy row, and every legacy row is a donor. This is the
// migration's promise held in code as well as in SQL, so the two cannot drift.
export function typesOf(row) {
  const v = row && (row.person_types ?? row.personTypes);
  if (v == null) return [DONOR_TYPE];
  const parsed = typeof v === "string" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v;
  if (!Array.isArray(parsed) || !parsed.length) return [DONOR_TYPE];
  return normalizeTypes(parsed);
}

export const isDonor = (row) => typesOf(row).includes(DONOR_TYPE);
export const hasType = (row, type) => typesOf(row).includes(type);

// Adding a type is idempotent and order-stable. A volunteer's first gift runs
// through HERE, never through a row insert.
export function addType(row, type) {
  return normalizeTypes([...typesOf(row), type]);
}

// ── THE PREDICATE ──────────────────────────────────────────────────────────
// Spliced into a WHERE clause wherever "donors" means money. `alias` is the
// table alias at the call site ("d", "donors", ""). NULL-tolerant on purpose:
// see the header. This is a CONSTANT SQL fragment with no interpolated
// user input — the alias is supplied by the call site, never by a request.
export function donorOnlySql(alias = "") {
  const col = (alias ? alias + "." : "") + "person_types";
  return `(${col} IS NULL OR ${col} @> '["donor"]'::jsonb)`;
}
// The inverse, for the surfaces that deliberately want the people who are NOT
// givers (the Mailchimp-replacement segments).
export function typeSql(type, alias = "") {
  const col = (alias ? alias + "." : "") + "person_types";
  if (type === DONOR_TYPE) return donorOnlySql(alias);
  return `(${col} @> '["${type}"]'::jsonb)`;
}

// The label a screen shows for a person's types, in canonical order.
export function typeLabels(row) {
  const t = typesOf(row);
  return PERSON_TYPES.filter(x => t.includes(x.key)).map(x => x.label);
}
