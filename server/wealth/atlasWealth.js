// server/wealth/atlasWealth.js · WEALTH-1. "SHOW ME MY 5S WHO HAVEN'T GIVEN THIS YEAR."
//
// Atlas reads a Wealth Score question the same way with AI on or off: this
// template turns the words into an askQuery.js plan (people, Wealth Score
// equals / at least / at most N, and optionally no gift, or a gift, since the
// fiscal year began), and routes/why.js runs it through the one query layer,
// so the count and the list open the same rows. A question that is not about
// a Wealth Score returns null and Atlas carries on as before.
//
// "My 5s" means the organisation's 5s, not only the people she owns: the
// person asking is usually the director, who owns nobody.
"use strict";

const WORD_NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, ones: 1, twos: 2, threes: 3, fours: 4, fives: 5 };

// The score the question names, and how ("eq" | "gte" | "lte"), or null.
function scoreIn(text) {
  const t = String(text || "").toLowerCase().replace(/[’']/g, "'");
  const wealth = /\bwealth\s*(score|rating|rank)?s?\b/.test(t);
  let n = null;
  // "my 5s", "our 4's", "the fives"
  const plural = /\b(?:my|our|the|all)\s+(?:([1-5])'?s|(ones|twos|threes|fours|fives))\b/.exec(t);
  if (plural) n = plural[1] ? Number(plural[1]) : WORD_NUM[plural[2]];
  // "wealth score of 5", "wealth score equal to 5", "wealth score 4 or higher", "a 5 wealth score"
  if (n == null && wealth) {
    const m = /\bwealth\s*(?:score|rating|rank)?\s*(?:of|is|=|equals?|equal to|equaling|at least|at most|above|below|over|under)?\s*(?:a\s+)?([1-5]|one|two|three|four|five)\b/.exec(t)
      || /\b(?:a|an)?\s*([1-5]|one|two|three|four|five)\s+wealth\b/.exec(t);
    if (m) n = /^\d$/.test(m[1]) ? Number(m[1]) : WORD_NUM[m[1]];
  }
  if (n == null) return null;
  // "my 5s" alone is a Wealth Score question only where nothing else claims the
  // number (a five-dollar gift, a top five): no money sign, no "top".
  if (!wealth && (/\$\s*\d|\btop\s+\d/.test(t))) return null;
  const op = /\b(at least|or (more|higher|above|better|up)|and (up|above|higher))\b|\+/.test(t) ? "gte"
    : /\b(at most|or (less|lower|below|under))\b/.test(t) ? "lte" : "eq";
  return { n, op };
}

// "haven't given this year" → none; "gave this year" → some; else no condition.
function givingThisYear(text) {
  const t = String(text || "").toLowerCase().replace(/[’']/g, "'");
  if (!/\bthis (fiscal )?year\b/.test(t)) return null;
  if (/\b(haven't|have not|hasn't|has not|didn't|did not|not yet|not)\b[^.?!]{0,20}\b(given|gave|give|donated|donate)\b/.test(t)) return "none";
  if (/\b(given|gave|donated)\b/.test(t)) return "some";
  return null;
}

// The plan, or null when this is not a Wealth Score question.
function planFor(text, { fyStart }) {
  const s = scoreIn(text);
  if (!s) return null;
  const plan = {
    entity: "people",
    where: [{ field: "wealth_score", op: s.op, value: s.n }],
    related: [],
    measure: { fn: "count", field: null }, list: true, limit: 50,
    sort: { by: "lifetime_giving", dir: "desc" },
  };
  const g = givingThisYear(text);
  if (g && fyStart) plan.related.push({ entity: "gifts", where: [{ field: "date", op: "gte", value: fyStart }], ...(g === "none" ? { none: true } : {}) });
  return plan;
}

module.exports = { scoreIn, givingThisYear, planFor };
