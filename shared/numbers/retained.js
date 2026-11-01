// shared/numbers/retained.js · NUMBERS-3. RETAINED: GAVE IN BOTH OF TWO FISCAL YEARS.
//
// A person is retained in a fiscal year when they gave (a gift: money above
// zero, money.js) in it and in the year before it. A refund is not giving
// again. The years come from fiscalYear.js; the rate is retained over the
// people who gave in the year before. computeRetentionRate (server.js), the
// retention sources and the Retained tag read these.
"use strict";
const { GIFT, LIVE } = require("./money");

// SQL: person `d` gave between two civil days (placeholders: from, to).
const GAVE_IN = (d = "d") => `EXISTS (SELECT 1 FROM gifts rg WHERE rg.org_id = ${d}.org_id AND rg.donor_id = ${d}.id AND ${GIFT("rg")} AND rg.date >= ? AND rg.date <= ?)`;

// The people who gave in `prior` and in `cur` ({from, to} each), and the prior year's givers.
async function retention(query, orgId, cur, prior) {
  const [r] = await query(
    `SELECT COUNT(*) FILTER (WHERE ${GAVE_IN("d")})::int AS kept, COUNT(*)::int AS prior
       FROM donors d WHERE d.org_id = ? AND ${LIVE("d")} AND ${GAVE_IN("d")}`,
    [cur.from, cur.to, orgId, prior.from, prior.to]);
  return { retained: r.kept, prior: r.prior, rate: r.prior ? r.kept / r.prior : null };
}

// The same rule over rows already read: [{ person, date, amount|cents, type }].
function retainedIds(rows, cur, prior) {
  const { isGift } = require("./money");
  const inSpan = (r, s) => { const d = String(r.date || "").slice(0, 10); return d && d >= s.from && d <= s.to; };
  const a = new Set(), b = new Set();
  for (const r of rows || []) if (isGift(r)) { if (inSpan(r, cur)) a.add(r.person); if (inSpan(r, prior)) b.add(r.person); }
  return [...a].filter(id => b.has(id)).sort();
}

module.exports = { GAVE_IN, retention, retainedIds };
