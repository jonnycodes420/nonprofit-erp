// server/finance/monthRows.js · TRUTH-6 (W-1107-Donors-21X). THE GIFTS BEHIND ONE MONTH'S BAR.
//
// The money is every money row (a refund comes off); the count is gifts by
// the one rule (giftCount.js), and every other row is listed with what it is:
// a refund, a gift refunded in full, a credit, a $0 record or a scheduled gift.
"use strict";
const NUM = require("../../shared/numbers");
const money = require("../../money");

function monthRows(m, rows) {
  const total = rows.filter(r => NUM.money.isMoney(r)).reduce((a, r) => a + Math.round(Number(r.amount) * 100), 0);
  const counted = rows.filter(r => NUM.giftCount.isCounted(r)).length;
  const other = rows.length - counted;
  const label = r => (NUM.giftCount.isCounted(r) ? null : r.scheduled ? "Scheduled, not counted yet" : Number(r.amount) < 0 ? "Refund, not counted"
    : r.refunded_in_full ? "Refunded in full, not counted" : !NUM.money.isMoney(r) ? "Credit, not money" : "$0, not counted");
  return { month: m, rows: rows.map(r => ({ ...r, amount: Number(r.amount), counted: NUM.giftCount.isCounted(r), label: label(r) })),
    count: counted, totalCents: total, total: total / 100,
    sentence: `${counted} ${counted === 1 ? "gift" : "gifts"} in ${m}, ${money.formatCentsPlain(total)}.${other ? ` Also listed: ${other} ${other === 1 ? "row" : "rows"} that ${other === 1 ? "is" : "are"} not a gift (a refund or a $0 record).` : ""}` };
}

module.exports = { monthRows };
