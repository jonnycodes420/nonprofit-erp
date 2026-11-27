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

// POLISH-15 item 1 (prod check, 27 Nov: "Fenwick Ravensmere did not surface
// by full name or surname"). The whole phrase was matched as one string, so
// "ravensmere f" or "Ravensmere Fenwick" found nobody. Now a name also matches
// when EVERY word typed starts a word of the name, in any order. The name's
// words are its folded letters and digits, split on anything else, so
// "Smith-Jones" has the words "smith" and "jones".
const NAME_WORDS = col => `(' ' || regexp_replace(${FOLD(col)}, '[^a-z0-9]+', ' ', 'g'))`;
// One argument: the typed words as a text[] (LIKE wildcards escaped). An empty
// list matches nothing (bool_and over no rows is NULL).
const NAME_WORDS_MATCH = `COALESCE((SELECT bool_and(${NAME_WORDS("donors.name")} LIKE '% ' || pmw.w || '%' ESCAPE '\\')
       FROM unnest(?::text[]) pmw(w)), false)`;
// The typed words, folded and escaped, from what somebody typed.
function nameWordsOf(q) {
  return fold(String(q || "")).split(/[^a-z0-9]+/).filter(Boolean).map(w => w.replace(/[\\%_]/g, ch => "\\" + ch));
}
// The same words from a foldedPattern(...) (what every caller already holds).
function wordsOfPattern(p) {
  const raw = String(p || "").replace(/^%|%$/g, "").replace(/\\(.)/g, "$1");
  return nameWordsOf(raw);
}

// The condition over an unaliased `donors` row. `p` is foldedPattern(...).
// Phone digits are matched by the callers, which already do it their way.
// REDTEAM-2: the text is a constant (it never depends on what was typed);
// only the eight arguments do. A caller composing SQL uses PERSON_MATCH_SQL.
const PERSON_MATCH_SQL = (() => {
  const E = "ESCAPE '\\'";
  return `(${FOLD("donors.name")} LIKE ? ${E} OR ${NAME_WORDS_MATCH} OR ${FOLD("donors.email")} LIKE ? ${E}
     OR ${FOLD("donors.contact_name")} LIKE ? ${E} OR ${FOLD("donors.employer")} LIKE ? ${E}
     OR lower(COALESCE(donors.phone,'')) LIKE ? ${E}
     OR EXISTS (SELECT 1 FROM households pmh WHERE pmh.org_id = donors.org_id AND pmh.id = donors.household_id AND ${FOLD("pmh.name")} LIKE ? ${E})
     OR EXISTS (SELECT 1 FROM donor_relationships pmr
                  JOIN donors pmo ON pmo.org_id = pmr.org_id AND pmo.deleted_at IS NULL
                   AND pmo.id = CASE WHEN pmr.donor_id_a = donors.id THEN pmr.donor_id_b ELSE pmr.donor_id_a END
                 WHERE pmr.org_id = donors.org_id AND (pmr.donor_id_a = donors.id OR pmr.donor_id_b = donors.id)
                   AND lower(COALESCE(pmo.kind,'')) IN ('organization','organisation') AND ${FOLD("pmo.name")} LIKE ? ${E}))`;
})();
function personMatchSql(p) {
  return { sql: PERSON_MATCH_SQL, args: [p, wordsOfPattern(p), p, p, p, p, p, p] };
}

// WALKB-1 · A RESULT SAYS WHY IT MATCHED. A search for "Marlowe" found seven
// people, two with no "Marlowe" anywhere a person could see: they matched on
// a household or a linked organization. Each row now carries the first thing
// that matched, in the same order the rule above reads, as "field\tvalue"
// ("name", "email\tmarlowe@…", "household\tThe Marlowe Hart household").
// `donors` is unaliased, as above. Arguments: p, repeated per branch.
const PERSON_MATCH_REASON_SQL = (() => {   // REDTEAM-2: a constant, as PERSON_MATCH_SQL
  const E = "ESCAPE '\\'";
  return `(CASE
      WHEN ${FOLD("donors.name")} LIKE ? ${E} OR ${NAME_WORDS_MATCH} THEN 'name'
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
})();
function personMatchReasonSql(p) {
  return { sql: PERSON_MATCH_REASON_SQL, args: [p, wordsOfPattern(p), p, p, p, p, p, p] };
}

// FLOWS-4 (W-1109-Volunteers-27) · THE ORDER A PERSON SEARCH ANSWERS IN.
// "Jonathan A" and Enter opened Jonathan Atkinson: every name containing the
// words ranked together and the larger giver won, so the exact match came
// third. POLISH-15 item 1 added the word tiers (2 and 4). On the whole query,
// folded:
//   0  the full name is exactly what was typed ("Jonathan A")
//   1  the name starts with it as whole words ("Jonathan A. Reyes")
//   2  every word typed is a whole word of the name ("Ravensmere" finds every
//      Ravensmere; "Ravensmere Fenwick" finds Fenwick Ravensmere)
//   3  the name starts with it ("Jonathan Atkinson")
//   4  the words typed are whole words of the name but the last, which
//      starts one: a name still being typed ("ravensmere f")
//   5  every word typed starts a word of the name ("raven fen")
//   6  the name contains it ("Mary Jonathan Abel")
//   7  something else matched (email, household, ...)
// Ties: the most recent activity first (last gift, then the last change to
// the record), then the id. Over an unaliased `donors`; args are rankArgs(q).
// NAME_RANK_SQL is the tier alone (args rankArgs(q)); a search row carries it
// so the top bar shows every whole-word match (WHOLE_WORD_TIER and below).
const NAME_RANK_SQL = `(CASE WHEN ${FOLD("donors.name")} = ? THEN 0
      WHEN ${FOLD("donors.name")} LIKE ? ESCAPE '\\' THEN 1
      WHEN COALESCE((SELECT bool_and(${NAME_WORDS("donors.name")} || ' ' LIKE '% ' || pmw.w || ' %' ESCAPE '\\')
             FROM unnest(?::text[]) pmw(w)), false) THEN 2
      WHEN ${FOLD("donors.name")} LIKE ? ESCAPE '\\' THEN 3
      WHEN COALESCE((SELECT bool_and(${NAME_WORDS("donors.name")} || ' ' LIKE '% ' || pmw.w || CASE WHEN pmw.n < cardinality(pmw.all_w) THEN ' %' ELSE '%' END ESCAPE '\\')
             FROM (SELECT x.w, x.n, ?::text[] AS all_w FROM unnest(?::text[]) WITH ORDINALITY x(w, n)) pmw), false) THEN 4
      WHEN ${NAME_WORDS_MATCH} THEN 5
      WHEN ${FOLD("donors.name")} LIKE ? ESCAPE '\\' THEN 6 ELSE 7 END)`;
const WHOLE_WORD_TIER = 2;
const RANK_ORDER_SQL = `${NAME_RANK_SQL},
    NULLIF(donors.last_gift_date, '') DESC NULLS LAST, donors.updated_at DESC NULLS LAST, donors.id`;
function rankArgs(q) {
  const f = fold(String(q || "").trim().replace(/\s+/g, " "));
  const esc = f.replace(/[\\%_]/g, ch => "\\" + ch);
  const words = nameWordsOf(q);
  return [f, esc + " %", words, esc + "%", words, words, words, "%" + esc + "%"];
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

module.exports = { FOLD, fold, foldedPattern, nameWordsOf, NAME_RANK_SQL, WHOLE_WORD_TIER, personMatchSql, personMatchReasonSql, PERSON_MATCH_SQL, PERSON_MATCH_REASON_SQL, matchReasonWords, RANK_ORDER_SQL, rankArgs };
