// shared/numbers/defaultFund.js · LEDGER-3 item 1. THE ORG'S ONE UNRESTRICTED FUND.
//
// There were four ways to pick "the unrestricted fund": orgs.default_fund_id,
// the oldest unrestricted fund (ensureOrgLedger), any unrestricted fund with no
// order, and in the demo seed the first by NAME. Alphabetically that is Gala
// Reserve, so the seed put 635 gifts on Gala Reserve while its ledger rows said
// General Operating. This is now the only rule:
//
//   orgs.default_fund_id, when it names a fund of this org,
//   else the oldest unrestricted fund (created_at, then id).
//
// Reads never write (a GET never changes state). A WRITE path calls
// ensureDefaultFund, which stamps orgs.default_fund_id once, marked
// `default_fund_by = 'system:defaultFund'`, so the answer stays put even if an
// older fund turns up later.
//
// Chosen vs picked. BUILD-88b's deposit sheet puts a blank memo on the default
// only if a PERSON chose one ("we do not know" is not "unrestricted"). A stamp
// by this module is not a choice, so CHOSEN_SQL reads default_fund_id only when
// no `system:` identity set it.
"use strict";

const SYSTEM = "system:defaultFund";

// The org's default fund id as a scalar subquery. `org` is an SQL expression
// for the org id: "$1", an outer column like "g.org_id", or "?" (then pass the
// org id twice).
const DEFAULT_FUND_SQL = (org) => `(SELECT COALESCE(
    (SELECT df.id FROM orgs dfo JOIN fin_funds df ON df.id = dfo.default_fund_id AND df.org_id = dfo.id WHERE dfo.id = ${org}),
    (SELECT df2.id FROM fin_funds df2 WHERE df2.org_id = ${org} AND df2.restricted IS NOT TRUE AND df2.retired_at IS NULL
      ORDER BY df2.created_at ASC NULLS LAST, df2.id ASC LIMIT 1)))`;

// The default a person chose (the deposit sheet's and the gift import's blank memo), or null.
const CHOSEN_SQL = (o = "o") => `(CASE WHEN ${o}.default_fund_by LIKE 'system:%' THEN NULL ELSE ${o}.default_fund_id END)`;

// READ ONLY. The default fund { id, name } or null. `query(sql, params)` with `?` placeholders.
async function defaultFund(query, orgId) {
  const [r] = await query(
    `SELECT f.id, f.name FROM fin_funds f WHERE f.org_id = ? AND f.id = ${DEFAULT_FUND_SQL("?")}`, [orgId, orgId, orgId]);
  return r ? { id: r.id, name: r.name } : null;
}
async function defaultFundId(query, orgId) {
  const f = await defaultFund(query, orgId);
  return f ? f.id : null;
}

// WRITE PATHS ONLY. The same answer, stamped on the org the first time.
// `known` is the answer when the caller already read it. The UPDATE runs only
// when there is something to stamp (a statement trigger fires even on 0 rows).
async function ensureDefaultFund(query, run, orgId, known) {
  const [o] = await query("SELECT default_fund_id FROM orgs WHERE id = ?", [orgId]);
  const id = known || await defaultFundId(query, orgId);
  if (id && o && !o.default_fund_id) await run(`UPDATE orgs SET default_fund_id = ?, default_fund_by = ? WHERE id = ? AND default_fund_id IS NULL`, [id, SYSTEM, orgId]);
  return id;
}

module.exports = { SYSTEM, DEFAULT_FUND_SQL, CHOSEN_SQL, defaultFund, defaultFundId, ensureDefaultFund };
