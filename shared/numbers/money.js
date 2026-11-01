// shared/numbers/money.js · NUMBERS-3. WHAT A TOTAL COUNTS AS MONEY.
//
// One predicate, and every money sum in Steward reads it:
//   · hard credit only. A gift row typed as a soft or matching credit is
//     recognition, never money (creditTypes.js, FIX-49); a soft-credit pointer
//     (gift_soft_credits) is never a gift row at all;
//   · a refund is a negative row and comes off the total (it is money that
//     went back out), but it is never a gift: GIFT() is money above zero;
//   · a row she marked Not a gift (Review, INSIGHTS-1) leaves `gifts` for
//     Finance (insight_reviews keeps it), so it is in no total by construction.
// A deleted person's gifts count toward nothing (LIVE).
"use strict";
const { NOT_CREDIT, isCredit } = require("../../creditTypes");
const M = require("../../money");

// SQL: gift row `g` is money in a total.
const MONEY = (g = "g") => NOT_CREDIT(g);
// SQL: gift row `g` is a gift: money above zero (a refund is not a gift).
const GIFT = (g = "g") => `(${NOT_CREDIT(g)} AND ${g}.amount > 0)`;
// SQL: person `d` counts (not deleted).
const LIVE = (d = "d") => `${d}.deleted_at IS NULL`;

// The same rules for rows already read: { amount | cents, type }.
const centsOf = r => (r.cents != null ? Number(r.cents) : (M.toCents(String(r.amount ?? "0")) ?? 0));
const isMoney = r => !isCredit(r && (r.type ?? r.gift_type));
const isGift = r => isMoney(r) && centsOf(r) > 0;
const sumCents = rows => (rows || []).filter(isMoney).reduce((n, r) => n + centsOf(r), 0);

module.exports = { MONEY, GIFT, LIVE, isMoney, isGift, sumCents, centsOf };
