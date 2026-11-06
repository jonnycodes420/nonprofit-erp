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
const { GIFT } = require("./money");

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

module.exports = { buntSql };
