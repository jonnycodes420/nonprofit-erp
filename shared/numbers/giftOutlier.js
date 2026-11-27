// shared/numbers/giftOutlier.js · IMPORT-11. A GIFT FAR OUTSIDE THE PATTERN ASKS FIRST.
//
// 27 Nov: a gift edited to $10,000,000 on a person whose only gift was $123.45
// saved without a question, and a $1,000,000,000 gift took over every report
// ("Retention reads 0% of $1,001,634,412.45"). The rule, one place, read by
// the gift form (new and edit) and the import preview:
//
//   A gift is far outside the pattern when it is at least 100 times the
//   person's usual gift (the median of their gifts above zero) AND at least
//   10 times the largest gift the org has (any other gift row of money). A
//   person with no gifts yet, or an org with none, asks nothing: there is no
//   pattern of theirs to be outside (a new business's first $10,500 gift is not
//   a mistake; an amount no gift can be is the cap's, money.js).
//
// It asks; it never refuses. The answer is hers ("Record it").
"use strict";
const { MONEY, LIVE } = require("./money");

const PERSON_TIMES = 100;
const ORG_TIMES = 10;

// The rule, on cents already read.
function farOutside({ cents, usualCents, largestCents }) {
  const c = Math.abs(Number(cents) || 0);
  if (!c || !(largestCents > 0) || !(usualCents > 0)) return null;
  const orgX = c / largestCents, personX = c / usualCents;
  if (orgX < ORG_TIMES || personX < PERSON_TIMES) return null;
  return { personTimes: personX, orgTimes: orgX };
}

// "81,000 times": two significant figures once it is in the hundreds.
function times(x) {
  if (x == null) return null;
  const r = x >= 100 ? Number(x.toPrecision(2)) : Math.round(x);
  return r.toLocaleString("en-US");
}

function sentence(f) {
  const parts = [];
  if (f.personTimes != null) parts.push(`${times(f.personTimes)} times their usual gift`);
  parts.push(`${times(f.orgTimes)} times the largest gift your org has`);
  return `This is ${parts.join(" and ")}. Record it?`;
}

// The person's usual gift and the org's largest, from the database. `except`
// is the gift being edited, left out of both so it is not its own pattern.
async function patternOf(query, orgId, donorId, except = null) {
  const [r] = await query(
    `SELECT
       (SELECT ROUND(100 * percentile_cont(0.5) WITHIN GROUP (ORDER BY g.amount))::bigint
          FROM gifts g WHERE g.org_id = ? AND g.donor_id = ? AND g.amount > 0 AND ${MONEY("g")} AND (?::text IS NULL OR g.id <> ?)) AS usual,
       (SELECT ROUND(100 * MAX(g.amount))::bigint
          FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
         WHERE g.org_id = ? AND g.amount > 0 AND ${MONEY("g")} AND ${LIVE("d")} AND (?::text IS NULL OR g.id <> ?)) AS largest`,
    [orgId, donorId || "", except, except, orgId, except, except]);
  return { usualCents: r && r.usual != null ? Number(r.usual) : 0, largestCents: r && r.largest != null ? Number(r.largest) : 0 };
}

// The form's question, or null: { code, sentence } for a 409.
async function askFor(query, { orgId, donorId, cents, except = null }) {
  const p = await patternOf(query, orgId, donorId, except);
  const f = farOutside({ cents, ...p });
  return f ? { error: "far_outside", code: "far_outside", sentence: sentence(f), ...p } : null;
}

module.exports = { farOutside, sentence, times, patternOf, askFor, PERSON_TIMES, ORG_TIMES };
