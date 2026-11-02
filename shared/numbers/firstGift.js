// shared/numbers/firstGift.js · NUMBERS-3. A PERSON'S FIRST GIFT, AND FIRST-TIME IN A YEAR.
//
// The first gift is the earliest dated gift (money above zero, money.js) or
// the old system's first gift (IMPORTED_FIRST: its first gift date, or its
// last when it gave only that), whichever is earlier. Imported history is
// giving, so a person whose old system says they gave in 2019 is not
// first-time when their first gift in Steward lands this year. A soft or
// matching credit row is recognition, never a gift, so it is never anyone's
// first gift (NUMBERS-4: seed 695574508 found the checker's key counting one).
// First-time in a span: the first gift falls inside it.
//
// NUMBERS-4: every place that says it reads this file: "Donor since" and the
// stored first_gift_date (donorSummary.js), the lifecycle tags and so the
// Donors filters and groups (donorStatus.statusSql), the `givers` source
// (first: new), the calls list and the groups' first-gift rule.
"use strict";
const { GIFT } = require("./money");

// FIX-49 · THE OLD SYSTEM'S FIRST GIFT. The file's first gift date when it
// gave one; when it gave only a last gift date, that date, because the person
// was already a donor on it (a file that gave no dates at all says nothing,
// and the day of the import is not a gift, so imported_through is never used
// here). Text, as stored.
const IMPORTED_FIRST = (a = "d") => `COALESCE(NULLIF(${a}.imported_first_gift_date, ''), NULLIF(${a}.imported_last_gift_date, ''))`;

// SQL aggregate over gift rows `g` already narrowed to one person: their first
// dated gift on file (YYYY-MM-DD), or NULL.
const FIRST_ON_FILE_AGG = (g = "g") => `MIN(LEFT(${g}.date, 10)) FILTER (WHERE ${g}.date IS NOT NULL AND ${GIFT(g)})`;
// NUMBERS-4: which gift is the first when two share its day: the one recorded
// first, then the one higher up its file (gifts.import_row), never a random id
// (one import writes every row with one created_at). lastGift.js mirrors it.
const FIRST_GIFT_ORDER = "g.date ASC, g.created_at ASC, g.import_row ASC NULLS LAST, g.amount DESC, g.id ASC";
// SQL: the earlier of the first gift on file and the old system's (either may be NULL).
const EARLIER = (onFile, imported) => `LEAST(${onFile}, LEFT(${imported}, 10))`;

// SQL: person `d`'s first gift date (YYYY-MM-DD), or NULL.
const FIRST_DATE = (d = "d") => EARLIER(`(SELECT ${FIRST_ON_FILE_AGG("fg")} FROM gifts fg WHERE fg.org_id = ${d}.org_id AND fg.donor_id = ${d}.id)`, IMPORTED_FIRST(d));

// Each person's first gift date: Map id -> date or null.
async function firstDates(query, orgId, ids) {
  if (!ids || !ids.length) return new Map();
  const rows = await query(`SELECT d.id, ${FIRST_DATE("d")} AS first FROM donors d WHERE d.org_id = ? AND d.id = ANY(?::text[])`, [orgId, ids]);
  return new Map(rows.map(r => [r.id, r.first ? String(r.first).slice(0, 10) : null]));
}

// The same rule over rows already read.
function firstOf(rows, importedFirst = null) {
  const { isGift } = require("./money");
  const ds = (rows || []).filter(r => r.date && isGift(r)).map(r => String(r.date).slice(0, 10)).sort();
  const imp = importedFirst ? String(importedFirst).slice(0, 10) : null;
  return [ds[0], imp].filter(Boolean).sort()[0] || null;
}
const isFirstTimeIn = (first, span) => !!first && first >= span.from && first <= span.to;

module.exports = { IMPORTED_FIRST, FIRST_GIFT_ORDER, FIRST_ON_FILE_AGG, EARLIER, FIRST_DATE, firstDates, firstOf, isFirstTimeIn };
