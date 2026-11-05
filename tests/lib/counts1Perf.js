// tests/lib/counts1Perf.js: COUNTS-1 item 4. GET /donors/counts IS FAST, AND
// SAYS WHAT IT SAID BEFORE.
//
//   const { checkCountsSpeed } = require("./lib/counts1Perf");
//   const diffs = await checkCountsSpeed({ token, orgId, q });   // [] when green
//
// Three checks, each a string in the returned list when it fails:
//   speed     the median of five warm reads is under BUDGET_MS (300). Sized for
//             LOAD-1's 25,000-person org (scripts/load/ten-orgs.js seed,
//             org_ten10: about 200 ms there on a laptop); a suite's own small
//             org is far under it. `budgetMs` in ctx overrides it.
//   the key   total and lapsed equal TRUTH-1's key (tests/keys/truthKey.js),
//             computed from the org's rows with no app code: people are live
//             rows; lapsed gave a hard-credit gift, the unit's last on or
//             before today less 365 days, not held by a pledge. Skipped for an
//             org whose rows the key cannot see the same way (ctx.noKey).
//   the old   all four numbers equal the route as it stood before COUNTS-1:
//             statusSql materialised whole, lifecycle = 'lapsed', its lapsing
//             column, and lapse.js reengageSql over every live person. That
//             query is written out here, so the narrow pass is held to it
//             byte for byte (lapsing carries INSIGHTS-1's rhythm rule, which
//             the key does not model, so the old route is its reference).
// Planted: a pg_sleep(0.4) in the route turns `speed` red; dropping the
// imported last gift from the narrow pass turns `the old` red on any org with
// imported history.
"use strict";
const H = require("../helpers");
const { computeKey } = require("../keys/truthKey");
const { orgRows } = require("../keys/fromDb");

const BUDGET_MS = 300;

// The route before COUNTS-1 (routes/donorLookups.js at 8b33f91), verbatim.
async function oldCounts(orgId) {
  const { query } = require("../../db");
  const DS = require("../../donorStatus");
  const today = await DS.todayFor(orgId);
  const st = DS.statusSql(orgId, today, await DS.cutsFor(orgId));
  const re = require("../../shared/numbers/lapse").reengageSql("donors", today);
  const [r] = await query(`WITH s AS MATERIALIZED (${st.sql})
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE s.lifecycle = 'lapsed')::int AS lapsed,
      COUNT(*) FILTER (WHERE s.lapsing)::int AS lapsing,
      COUNT(*) FILTER (WHERE ${re.sql})::int AS reengage
    FROM donors LEFT JOIN s ON s.donor_id = donors.id WHERE org_id = ? AND deleted_at IS NULL`, [...st.args, ...re.args, orgId]);
  return r;
}

async function checkCountsSpeed(ctx = {}) {
  const { token, orgId } = ctx;
  const q = ctx.q || H.q;
  const budget = ctx.budgetMs || BUDGET_MS;
  const diffs = [];
  const read = async () => {
    const t0 = performance.now();
    const r = await H.api("GET", "/donors/counts", token);
    return { ms: performance.now() - t0, status: r.status, body: r.body };
  };
  const first = await read();   // warm
  if (first.status !== 200) return [`/donors/counts answered ${first.status}`];
  const times = [];
  for (let i = 0; i < 5; i++) times.push((await read()).ms);
  const median = times.slice().sort((a, b) => a - b)[2];
  if (median > budget) diffs.push(`speed: /donors/counts took ${Math.round(median)} ms (median of 5 warm reads; budget ${budget} ms; reads ${times.map(Math.round).join(", ")})`);
  const got = first.body;

  if (!ctx.noKey) {
    const kr = await orgRows(q, orgId);
    const key = computeKey(kr.rows, kr.opts);
    if (got.total !== key.people) diffs.push(`the key: /donors/counts total ${got.total}, the key's live people ${key.people}`);
    if (got.lapsed !== key.lapsed.length) diffs.push(`the key: /donors/counts lapsed ${got.lapsed}, the key's lapsed ${key.lapsed.length}`);
  }
  const old = await oldCounts(orgId);
  for (const k of ["total", "lapsed", "lapsing", "reengage"])
    if (got[k] !== old[k]) diffs.push(`the old: /donors/counts ${k} ${got[k]}, the route before COUNTS-1 said ${old[k]}`);
  if (JSON.stringify(got) !== JSON.stringify(old)) diffs.push(`the old: body ${JSON.stringify(got)} is not byte-identical to ${JSON.stringify(old)}`);
  return diffs;
}

module.exports = { checkCountsSpeed, oldCounts, BUDGET_MS };
