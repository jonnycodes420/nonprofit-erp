// shared/numbers/atRisk.js · TRUTH-4. THE MONEY AT RISK WHEN SOMEONE STOPS GIVING.
//
// W-1108-Fundraising-15: Lost & Found said $366,019 and Who stopped giving
// $128,432 for the same 235 people, and neither said what it added up. One
// definition now: a lapsed person's LAST YEAR OF GIVING, the money they gave
// (money.js MONEY: refunds off, credit rows out) in the twelve months ending on
// their last gift (a gift above $0, giftCount.js). That is what a year of
// them is worth, the amount a re-engaged donor would bring back. Lifetime can
// be shown beside it, labeled. Lost & Found's tile, the Lost report's total
// and their rows all read LAST_YEAR_OF_GIVING.
"use strict";
const { MONEY, GIFT } = require("./money");

const LABEL = "Last year of giving";
const SENTENCE = "At risk: each person's last year of giving, the money they gave in the twelve months ending on their last gift, added up. Lifetime is shown beside it.";

// SQL: person `d`'s last year of giving, dollars (0 when they never gave in Steward).
const LAST_YEAR_OF_GIVING = (d = "d") => `(SELECT COALESCE(SUM(ay.amount), 0) FROM gifts ay,
      (SELECT LEFT(MAX(al.date), 10) AS last FROM gifts al WHERE al.org_id = ${d}.org_id AND al.donor_id = ${d}.id AND ${GIFT("al")}
          AND al.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}') l
     WHERE ay.org_id = ${d}.org_id AND ay.donor_id = ${d}.id AND ${MONEY("ay")} AND l.last IS NOT NULL
       AND LEFT(ay.date, 10) <= l.last AND LEFT(ay.date, 10) > to_char(l.last::date - INTERVAL '12 months', 'YYYY-MM-DD'))`;

// JS, over gift rows already read ({ date, amount, type }): the same figure, in cents.
function lastYearOfGivingCents(rows) {
  const { isMoney, isGift, centsOf } = require("./money");
  const dated = (rows || []).filter(r => /^\d{4}-\d{2}-\d{2}/.test(String(r.date || "")));
  const last = dated.filter(isGift).map(r => String(r.date).slice(0, 10)).sort().pop();
  if (!last) return 0;
  const d = new Date(last + "T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 12);
  const from = d.toISOString().slice(0, 10);
  return dated.filter(r => isMoney(r) && String(r.date).slice(0, 10) <= last && String(r.date).slice(0, 10) > from).reduce((n, r) => n + centsOf(r), 0);
}

module.exports = { LABEL, SENTENCE, LAST_YEAR_OF_GIVING, lastYearOfGivingCents };
