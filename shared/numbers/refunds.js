// shared/numbers/refunds.js · MONEY-4 (W-1109-Finance-27). WHAT HAS BEEN REFUNDED ON A GIFT.
// A refund is a negative gift row linked to the gift it refunds (gifts.refund_of);
// the original stays as it was. One home for the two sums every reader needs:
//   REFUNDED_CENTS(org, gift)  whole cents refunded so far on one gift (>= 0); binds (org id, gift id) as ? ?
//   NET_AMOUNT(g)              gift row `g`'s amount less its refunds, in dollars (a receipt's "the gift as it is now")
"use strict";
const REFUNDED_CENTS_SQL = "SELECT COALESCE(-SUM(ROUND(amount * 100)), 0)::bigint AS c FROM gifts WHERE org_id = ? AND refund_of = ?";
const NET_AMOUNT = (g = "g") => `(${g}.amount + COALESCE((SELECT SUM(rf.amount) FROM gifts rf WHERE rf.org_id = ${g}.org_id AND rf.refund_of = ${g}.id), 0))`;
// $n placeholders for a raw pg caller (the webhook).
const REFUNDED_CENTS_PG = REFUNDED_CENTS_SQL.replace("org_id = ?", "org_id = $1").replace("refund_of = ?", "refund_of = $2");
module.exports = { REFUNDED_CENTS_SQL, REFUNDED_CENTS_PG, NET_AMOUNT };
