// shared/numbers/bunt.js · TRUTH-2. LYBUNT AND SYBUNT, ONE RULE.
//
// LYBUNT: a person who gave in the prior year and has given nothing in this
// one. SYBUNT: a person who gave in some year before this one and has given
// nothing in this one. "Gave" is a GIFT (money.js GIFT: hard credit, above
// zero): a $0 row, a refund or a soft credit is not giving, so it neither puts
// a person on the list nor takes them off it. The person is live (not
// deleted), not a sample row, and not erased (an erased person counts nowhere,
// TRUTH-2 item 5).
//
// Walk A (5 Nov) found two rules: the report's header (figureSources `bunt`)
// read amount > 0, and the report's rows and the group page
// (handlers.buntPredicate) read any row. One person with a $0 gift this year
// was in the header (310, $428,081) and not in the list or the group (309,
// $425,422); SYBUNT was 555 against 554 the same way.
"use strict";
const { GIFT, MONEY } = require("./money");

const gave = (a, span) => `EXISTS (SELECT 1 FROM gifts bg WHERE bg.org_id = ${a}.org_id AND bg.donor_id = ${a}.id AND ${GIFT("bg")} AND ${span})`;

// SQL for person alias `a` and its args, in order. kind lybunt | sybunt; cur
// and prior are { from, to } (prior is read only for lybunt).
function buntSql(kind, cur, prior, a = "d") {
  if (kind !== "lybunt" && kind !== "sybunt") throw new Error("kind is lybunt or sybunt");
  const before = kind === "lybunt" ? gave(a, "bg.date >= ? AND bg.date <= ?") : gave(a, "bg.date < ?");
  return {
    sql: `(${a}.erased_at IS NULL AND ${a}.is_sample IS NOT TRUE AND ${before} AND NOT ${gave(a, "bg.date >= ? AND bg.date <= ?")})`,
    args: [...(kind === "lybunt" ? [prior.from, prior.to] : [cur.from]), cur.from, cur.to],
  };
}

// MOPUP-3 · LYBUNT, SET-WISE. The rule above as a predicate is a semi-join
// over the prior year's gifts and an anti-join over this year's; Postgres built
// the prior year's hash once in each parallel worker, and the report ran it
// three times (the rows, the count, the money at stake), each row then reading
// its last year twice more (givingBetween.LAST_YEAR_JOIN / LAST_YEAR_SUM). On
// the nightly load test /reports/lybunt was 1,735 ms p95 (bar 1.5 s).
//
// The same rule in one pass over the two years' gifts, one row per person:
// MONEY rows (money.js), "gave" = above zero, so a GIFT exactly. Each person's
// amount is LAST_YEAR_SUM's: someone on LYBUNT has a gift in the prior year and
// none since, so the last year they gave IS the prior year, and the sum is the
// prior year's MONEY rows (a refund in it counts, as there). That holds only
// when the prior year is the year givingBetween counts back from this one, so
// a caller checks `samePrior` and keeps the old form otherwise.
// Returns a derived table (donor_id, prior_sum) and its args, in order.
function lybuntSet(orgId, cur, prior) {
  return {
    sql: `(SELECT bg.donor_id, SUM(bg.amount) FILTER (WHERE bg.date >= ? AND bg.date <= ?) AS prior_sum
             FROM gifts bg
            WHERE bg.org_id = ? AND bg.date >= ? AND bg.date <= ? AND ${MONEY("bg")}
            GROUP BY bg.donor_id
           HAVING BOOL_OR(bg.amount > 0 AND bg.date >= ? AND bg.date <= ?)
              AND NOT BOOL_OR(bg.amount > 0 AND bg.date >= ? AND bg.date <= ?))`,
    args: [prior.from, prior.to, orgId, prior.from < cur.from ? prior.from : cur.from, prior.to > cur.to ? prior.to : cur.to,
           prior.from, prior.to, cur.from, cur.to],
  };
}
// The person filter that goes with it (the rule's live, not sample, not erased).
const LIVE_PERSON = (a = "d") => `${a}.erased_at IS NULL AND ${a}.is_sample IS NOT TRUE`;
// Whether the prior year is the one givingBetween.LAST_YEAR_* would name.
function samePrior(cur, prior) {
  const y = require("./givingBetween").yearsBefore(cur.from, 1);
  return y.froms[0] === prior.from && y.tos[0] === prior.to;
}

module.exports = { buntSql, lybuntSet, LIVE_PERSON, samePrior };
