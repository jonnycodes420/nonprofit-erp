// shared/numbers/allGifts.js · POLISH-14 item 3. EVERY GIFT ON FILE, DATED OR NOT.
//
// Duet (27 Nov): Finance read $354,497.50 / 495 gifts, Reports' All time
// $353,997.50 / 493. Finance counted every gift on file; Reports' All time was
// the gifts figure from 1900 to today, which a gift with no date is never in.
// Both were "all time". Now both read this one definition:
//   every money row (money.js MONEY: hard credit, refunds off, a scheduled gift
//   not until its day) of a person who is not in the trash (LIVE), dated or not.
// A gift with no date is in this total and in Lifetime, in no year's total
// (Year over year lists it on its own line, "No date on the gift"), and in
// Finance's Waiting to post until a date is added (it cannot post without one).
// The count is gifts by the one rule (giftCount.js), the money every money row.
"use strict";
const { MONEY, LIVE, GIFT } = require("./money");

const DATED = (g = "g") => `(COALESCE(LEFT(${g}.date, 10), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')`;
const UNDATED = (g = "g") => `(NOT ${DATED(g)})`;
// SQL: gift row `g` of person `d` is in the all-time total.
const ALL = (g = "g", d = "d") => `(${LIVE(d)} AND ${MONEY(g)})`;

const usd = c => (c < 0 ? "−" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: Math.abs(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const gifts = n => `${n.toLocaleString("en-US")} ${n === 1 ? "gift" : "gifts"}`;

// { n, cents, undated: { n, cents } }
async function allGifts(query, orgId) {
  const [r] = await query(
    `SELECT COUNT(*) FILTER (WHERE ${GIFT("g")})::int AS n, COALESCE(SUM(ROUND(g.amount * 100)), 0)::bigint AS cents,
            COUNT(*) FILTER (WHERE ${GIFT("g")} AND ${UNDATED("g")})::int AS un,
            COALESCE(SUM(ROUND(g.amount * 100)) FILTER (WHERE ${UNDATED("g")}), 0)::bigint AS uc
       FROM gifts g JOIN donors d ON d.id = g.donor_id AND d.org_id = g.org_id
      WHERE g.org_id = ? AND ${ALL("g", "d")}`, [orgId]);
  return { n: Number(r && r.n) || 0, cents: Number(r && r.cents) || 0, undated: { n: Number(r && r.un) || 0, cents: Number(r && r.uc) || 0 } };
}

// The one sentence under an all-time figure: what it counts and where the undated gifts are.
const SENTENCE = "Every gift on file, dated or not, refunds taken off, soft and matching credits left out.";
function undatedWords(undated, where = "reports") {
  const u = undated || { n: 0, cents: 0 };
  if (!u.n && !u.cents) return "No gift on file is missing its date.";
  const lead = `${gifts(u.n)} (${usd(u.cents)}) ${u.n === 1 ? "has" : "have"} no date.`;
  return where === "finance"
    ? `${lead} ${u.n === 1 ? "It is" : "They are"} in Waiting to post until a date is added, and in Reports' All time, but in no year's total.`
    : `${lead} ${u.n === 1 ? "It is" : "They are"} in this total and in Finance's Waiting to post, and in no year's total (Year over year lists ${u.n === 1 ? "it" : "them"} as "No date on the gift").`;
}

module.exports = { DATED, UNDATED, ALL, SENTENCE, allGifts, undatedWords };
