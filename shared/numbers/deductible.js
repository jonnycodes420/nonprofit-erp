// shared/numbers/deductible.js · NUMBERS-9 item 2. WHAT IS DEDUCTIBLE, ACROSS THE GIFTS A PAPER COVERS.
//
// The fleet (W-1126-Donors-T3, tax): a donor gave $600 in two gifts, one of them a $500 gala seat
// with $190 of dinner. The letters list said deductible $410; his printed letter said $310, the one
// gift's figure: the letter's only deductible line was the goods-and-services disclosure under the
// one gift that bought something, and nothing on the page added the gifts up. A year-end statement
// read a third rule (the stored deductible, else the whole gift, never the fair market value).
//
// One rule now, for the letter, the letters list, the gift receipt and the year-end statement:
//   a gift's deductible part is the stored deductible amount when one was recorded, else the gift
//   less the fair market value of what was received (quid_pro_quo_value), never below $0 and never
//   above the gift. A refund row (amount at or below $0) comes off as it is.
//   Across gifts it is that, summed, in integer cents.
"use strict";
const M = require("../../money");

const cents = v => (v == null || v === "" ? null : (M.toCents(String(v)) ?? Math.round(Number(v) * 100)));

// One gift: { amount, deductible_amount | deductible, quid_pro_quo_value | qpqValue }. Integer cents.
function giftDeductibleCents(g) {
  const amt = cents(g && g.amount) || 0;
  if (amt <= 0) return amt;
  const stored = cents(g.deductible_amount !== undefined ? g.deductible_amount : g.deductible);
  if (stored != null) return Math.max(0, Math.min(stored, amt));
  const fmv = cents(g.quid_pro_quo_value !== undefined ? g.quid_pro_quo_value : g.qpqValue) || 0;
  return Math.max(0, amt - fmv);
}
// What was received for one gift (fair market value), in cents: the gift less its deductible part.
const giftFmvCents = g => { const amt = cents(g && g.amount) || 0; return amt > 0 ? amt - giftDeductibleCents(g) : 0; };

// Several gifts: { totalCents, deductibleCents, fmvCents, lines: [{ id, date, amountCents, fmvCents, deductibleCents }] }.
function deductibleAcross(gifts) {
  const lines = (gifts || []).map(g => ({ id: g.id, date: g.date, amountCents: cents(g.amount) || 0, fmvCents: giftFmvCents(g), deductibleCents: giftDeductibleCents(g) }));
  const sum = k => lines.reduce((n, l) => n + l[k], 0);
  return { lines, totalCents: sum("amountCents"), deductibleCents: sum("deductibleCents"), fmvCents: sum("fmvCents") };
}

const SENTENCE = "Deductible is each gift less the fair market value of anything received for it (a ticket, a dinner, an auction item), never below $0, added across the gifts.";

module.exports = { giftDeductibleCents, giftFmvCents, deductibleAcross, SENTENCE };
