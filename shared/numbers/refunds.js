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
// FLOWS-9: gift ? (org ?) is marked refunded in full exactly when its refunds net it to $0 or less.
// Run after a refund row is taken back, so every count (giftCount.js reads the mark) agrees again.
const REMARK_IN_FULL_SQL = `UPDATE gifts SET refunded_in_full = (${NET_AMOUNT("gifts")} <= 0) WHERE id = ? AND org_id = ?`;

// DEFINE-1 item 6 · REFUNDS COUNTED ONE WAY, AND SAID AS WHICH. Jarvis (22 Nov):
// "refunded gifts counted three ways on three surfaces". The profile's average
// counted refund ROWS (two partial refunds on one gift: "2"), a figure's panel
// counted refund rows and gifts refunded in full as one "rows" number, and the
// gift list summed each gift's refunds itself. A refund figure is now one of two
// things, and its words say which:
//   money returned   RETURNED_CENTS: the refund rows' amounts, as a positive sum ("$120 returned")
//   gifts affected   GIFTS_AFFECTED: each gift with at least one refund, once; a refund
//                    row with no gift on file (an import's negative) is one gift ("2 gifts refunded")
// Aggregates over gift alias `g`; the caller's WHERE picks the rows (money.js MONEY for money).
// `where` (optional SQL) narrows the rows further, e.g. a figure panel's not-counted rows.
const RETURNED_CENTS = (g = "g", where = null) => `COALESCE(-SUM(ROUND(${g}.amount * 100)) FILTER (WHERE ${where ? `(${where}) AND ` : ""}${g}.amount < 0), 0)::bigint`;
const GIFTS_AFFECTED = (g = "g") => `(COUNT(DISTINCT COALESCE(${g}.refund_of, ${g}.id)) FILTER (WHERE ${g}.amount < 0))::int`;
const usd = cents => "$" + (Math.round(Number(cents) || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: Math.round(Number(cents) || 0) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const returnedWords = cents => `${usd(cents)} returned`;
const affectedWords = n => `${Number(n) || 0} ${Number(n) === 1 ? "gift" : "gifts"} refunded`;
// "$120 returned on 2 gifts refunded" style, for a line that states both.
const refundWords = ({ cents, gifts }) => `${returnedWords(cents)} on ${affectedWords(gifts)}`;
const SENTENCE = "Refunds: money returned is the sum of the refund rows; gifts refunded counts each gift with a refund once, however many refunds it had.";

module.exports = { REFUNDED_CENTS_SQL, REFUNDED_CENTS_PG, NET_AMOUNT, REMARK_IN_FULL_SQL,
  RETURNED_CENTS, GIFTS_AFFECTED, returnedWords, affectedWords, refundWords, SENTENCE };
