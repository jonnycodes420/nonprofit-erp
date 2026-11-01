// shared/numbers/firstGift.js · NUMBERS-3. A PERSON'S FIRST GIFT, AND FIRST-TIME IN A YEAR.
//
// The first gift is the earliest dated gift (money above zero, money.js) or
// the old system's first gift (donorSummary.IMPORTED_FIRST: its first gift
// date, or its last when it gave only that), whichever is earlier. Imported
// history is giving, so a person whose old system says they gave in 2019 is
// not first-time when their first gift in Steward lands this year. This is
// the rule the `givers` source (first: new) and the New tag read.
// First-time in a span: the first gift falls inside it.
"use strict";
const { GIFT } = require("./money");
const { IMPORTED_FIRST } = require("../../donorSummary");

// SQL: person `d`'s first gift date (YYYY-MM-DD), or NULL.
const FIRST_DATE = (d = "d") => `LEAST((SELECT MIN(LEFT(fg.date, 10)) FROM gifts fg WHERE fg.org_id = ${d}.org_id AND fg.donor_id = ${d}.id AND fg.date IS NOT NULL AND ${GIFT("fg")}),
                                        LEFT(${IMPORTED_FIRST(d)}, 10))`;

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

module.exports = { FIRST_DATE, firstDates, firstOf, isFirstTimeIn };
