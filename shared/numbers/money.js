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
// TRUTH-6: a scheduled gift (dated after today, scheduled.js) is money on its
// date, not before: it is in no total until then.
const { DUE } = require("./scheduled");
const MONEY = (g = "g") => `(${NOT_CREDIT(g)} AND ${DUE(g)})`;
// SQL: gift row `g` is a gift: money above zero (a refund is not a gift).
// MONEY-4: a gift refunded in full (Record a refund) stays on file, netted to
// $0 by its refund row, and is no longer a gift: the count drops only then.
const GIFT = (g = "g") => `(${NOT_CREDIT(g)} AND ${g}.amount > 0 AND ${g}.refunded_in_full IS NOT TRUE AND ${DUE(g)})`;
// SQL: person `d` counts (not deleted).
const LIVE = (d = "d") => `${d}.deleted_at IS NULL`;
// SQL: the money total of gift rows `g`, in dollars (0 when none), with an
// optional further condition on the row (NUMBERS-5: a report column, a per-person
// total, a window). The credit rule is inside the sum, so no caller can forget it.
const and = where => (where ? ` AND (${where})` : "");
const MONEY_SUM = (g = "g", where = "") => `COALESCE(SUM(${g}.amount) FILTER (WHERE ${MONEY(g)}${and(where)}), 0)`;
// The same total in whole cents (bigint).
const MONEY_CENTS = (g = "g", where = "") => `COALESCE(SUM(ROUND(${g}.amount * 100)) FILTER (WHERE ${MONEY(g)}${and(where)}), 0)::bigint`;

// The same rules for rows already read: { amount | cents, type }.
const centsOf = r => (r.cents != null ? Number(r.cents) : (M.toCents(String(r.amount ?? "0")) ?? 0));
// A row read with `scheduled: true` (its day has not come, scheduled.js) is not money yet.
const isMoney = r => !isCredit(r && (r.type ?? r.gift_type)) && !(r && r.scheduled === true);
const isGift = r => isMoney(r) && centsOf(r) > 0 && !(r.refunded_in_full === true || r.refundedInFull === true);
const sumCents = rows => (rows || []).filter(isMoney).reduce((n, r) => n + centsOf(r), 0);

// TRUTH-2 · A DONOR COUNT. The people who gave in a set of rows: a gift above
// zero (a $0 row or a refund makes nobody a donor), from a person who is not
// erased (an erased person counts nowhere; their gifts stay in the money).
// Fundraising said 363 and the Giving summary 362 when one person's only row
// was a $0 gift. Needs person alias `d` joined.
// FLOWS-9: a person whose only gift was refunded in full gave nothing (GIFT's own refund rule).
const GIVERS = (g = "g", d = "d") => `COUNT(DISTINCT ${g}.donor_id) FILTER (WHERE ${g}.amount > 0 AND ${g}.refunded_in_full IS NOT TRUE AND ${d}.erased_at IS NULL)`;

module.exports = { GIVERS, MONEY, GIFT, LIVE, MONEY_SUM, MONEY_CENTS, isMoney, isGift, sumCents, centsOf };
