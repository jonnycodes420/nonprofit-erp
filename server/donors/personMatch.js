// server/donors/personMatch.js · LIST-2. WHO A SEARCH FOR A PERSON FINDS.
//
// One rule for the top bar (routes/search.js) and the Donors list's search
// box (groups.js buildDonorFilter): a person is found by their first, last or
// full name, their email, their phone, an organization's contact person, the
// name of their household, or the name of an organization they are linked
// to (a relationship on file, or their employer). Case and accents don't
// matter: "zoe angstrom" finds "Zoë Ångström".
//
// Accents are folded with translate(), plain SQL, so no database extension is
// needed. The words typed are folded the same way here before they are used.
"use strict";

const PAIRS = { a: "áàâäãåāăą", c: "çćč", d: "ďð", e: "éèêëēėęě", i: "íìîïīį", n: "ñńň", o: "óòôöõøōő", r: "ř", s: "śšşß", t: "ťþ",
  u: "úùûüūůűų", y: "ýÿ", z: "žźż" };
// Capitals too: under a C collation the database's lower() leaves "Å" as it is.
const UPPER = ch => { const u = ch.toUpperCase(); return u.length === 1 && u !== ch ? u : ""; };
const FROM = Object.values(PAIRS).map(f => [...f].map(ch => ch + UPPER(ch)).join("")).join("");
const TO = Object.entries(PAIRS).map(([to, f]) => [...f].map(ch => to + (UPPER(ch) ? to : "")).join("")).join("");
if (FROM.length !== TO.length) throw new Error("personMatch: the fold table is uneven");

// SQL: the column, lower-cased with its accents taken off.
const FOLD = col => `translate(lower(COALESCE(${col}, '')), '${FROM}', '${TO}')`;

// JS: the same fold, for what somebody typed.
function fold(s) {
  const lower = String(s || "").toLowerCase();
  let out = "";
  for (const ch of lower) { const i = FROM.indexOf(ch); out += i >= 0 ? TO[i] : ch; }
  return out.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// A LIKE pattern from what somebody typed, folded, its own wildcards escaped.
function foldedPattern(q) {
  return "%" + fold(String(q).trim()).replace(/[\\%_]/g, ch => "\\" + ch) + "%";
}

// The condition over an unaliased `donors` row. `p` is foldedPattern(...).
// Phone digits are matched by the callers, which already do it their way.
function personMatchSql(p) {
  const E = "ESCAPE '\\'";
  const sql = `(${FOLD("donors.name")} LIKE ? ${E} OR ${FOLD("donors.email")} LIKE ? ${E}
     OR ${FOLD("donors.contact_name")} LIKE ? ${E} OR ${FOLD("donors.employer")} LIKE ? ${E}
     OR lower(COALESCE(donors.phone,'')) LIKE ? ${E}
     OR EXISTS (SELECT 1 FROM households pmh WHERE pmh.org_id = donors.org_id AND pmh.id = donors.household_id AND ${FOLD("pmh.name")} LIKE ? ${E})
     OR EXISTS (SELECT 1 FROM donor_relationships pmr
                  JOIN donors pmo ON pmo.org_id = pmr.org_id AND pmo.deleted_at IS NULL
                   AND pmo.id = CASE WHEN pmr.donor_id_a = donors.id THEN pmr.donor_id_b ELSE pmr.donor_id_a END
                 WHERE pmr.org_id = donors.org_id AND (pmr.donor_id_a = donors.id OR pmr.donor_id_b = donors.id)
                   AND lower(COALESCE(pmo.kind,'')) IN ('organization','organisation') AND ${FOLD("pmo.name")} LIKE ? ${E}))`;
  return { sql, args: [p, p, p, p, p, p, p] };
}

// WALKB-1 · A RESULT SAYS WHY IT MATCHED. A search for "Marlowe" found seven
// people, two with no "Marlowe" anywhere a person could see: they matched on
// a household or a linked organization. Each row now carries the first thing
// that matched, in the same order the rule above reads, as "field\tvalue"
// ("name", "email\tmarlowe@…", "household\tThe Marlowe Hart household").
// `donors` is unaliased, as above. Arguments: p, repeated per branch.
function personMatchReasonSql(p) {
  const E = "ESCAPE '\\'";
  const sql = `(CASE
      WHEN ${FOLD("donors.name")} LIKE ? ${E} THEN 'name'
      WHEN ${FOLD("donors.email")} LIKE ? ${E} THEN 'email' || chr(9) || donors.email
      WHEN ${FOLD("donors.contact_name")} LIKE ? ${E} THEN 'contact' || chr(9) || donors.contact_name
      WHEN ${FOLD("donors.employer")} LIKE ? ${E} THEN 'employer' || chr(9) || donors.employer
      WHEN lower(COALESCE(donors.phone,'')) LIKE ? ${E} THEN 'phone' || chr(9) || donors.phone
      ELSE COALESCE(
        (SELECT 'household' || chr(9) || pmh.name FROM households pmh
          WHERE pmh.org_id = donors.org_id AND pmh.id = donors.household_id AND ${FOLD("pmh.name")} LIKE ? ${E} LIMIT 1),
        (SELECT 'organization' || chr(9) || pmo.name FROM donor_relationships pmr
           JOIN donors pmo ON pmo.org_id = pmr.org_id AND pmo.deleted_at IS NULL
            AND pmo.id = CASE WHEN pmr.donor_id_a = donors.id THEN pmr.donor_id_b ELSE pmr.donor_id_a END
          WHERE pmr.org_id = donors.org_id AND (pmr.donor_id_a = donors.id OR pmr.donor_id_b = donors.id)
            AND lower(COALESCE(pmo.kind,'')) IN ('organization','organisation') AND ${FOLD("pmo.name")} LIKE ? ${E} LIMIT 1),
        'phone')
    END)`;
  return { sql, args: [p, p, p, p, p, p, p] };
}

// The words a person reads for a reason: "email: marlowe@harbor.org".
const REASON_LABEL = { email: "email", contact: "contact person", employer: "employer", phone: "phone", household: "household", organization: "organization" };
function matchReasonWords(reason) {
  const [field, ...rest] = String(reason || "").split("\t");
  if (!field || field === "name") return field === "name" ? "name" : "";
  const value = rest.join("\t").trim();
  const label = REASON_LABEL[field] || field;
  return value ? `${label}: ${value}` : label;
}

module.exports = { FOLD, fold, foldedPattern, personMatchSql, personMatchReasonSql, matchReasonWords };
