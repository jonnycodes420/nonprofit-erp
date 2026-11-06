// server/groups/starterCounts.js · INSIGHTS-2 item 2. EVERY STARTER GROUP'S
// COUNT IN ONE PASS OVER THE ORG.
//
// groups.js memberCounts counted each starter as its own subquery: nineteen
// whole-org scans in one statement (fourteen starters, and the five asking
// ones again without the do-not-solicit rule), four of them recomputing the
// whole-org status (statusSql) for Lapsing and Lapsed. 2.1 to 2.3 s on a
// 25,000-person org locally, over the 10 s guard on CI. The statement is
// shared/numbers/starterCounts.js; this reads the windows it needs (the same
// reportHooks.yearWindows, thanksSince and donorStatus the rules read) and
// runs it on the set-wise pool.
"use strict";
const { query, querySetwise } = require("../../db");
const NUM = require("../../shared/numbers/starterCounts");

async function starterCounts(orgId, starters) {
  const RH = require("../../routes/crm").reportHooks;
  const DS = require("../../donorStatus");
  const [{ cur, prior }, since, today, cuts] = await Promise.all([RH.yearWindows(orgId), RH.thanksSince(orgId), DS.todayFor(orgId), DS.cutsFor(orgId)]);
  // FLOWS-2: "Monthly givers" is the one gives-monthly rule (shared/numbers/givesMonthly.js), as its group is.
  const monthlyIds = starters.some(x => (x.key || x) === "monthly") ? await require("../../shared/numbers/givesMonthly").givesMonthlyIds(query, orgId, today) : [];
  const { sql, args } = NUM.starterCountsSql({ orgId, cur, prior, since, status: DS.statusSql(orgId, today, cuts), starters, monthlyIds });
  const [row] = await querySetwise(sql, args);
  return NUM.countsOf(row, starters);
}

module.exports = { starterCounts };
