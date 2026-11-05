// server/grants/awardLedger.js · LEDGER-2. AN AWARD BOOKS ITS INCOME.
//
// GRANTS-FIX made PUT /grants/:id/award the only way into Awarded, and it
// writes the pledge on the funder. The ledger income row the general PUT wrote
// on its Awarded transition (stampGrantAward, Finance entity-routing FIX) was
// not carried over, so Fundraising showed the promise and Finance showed
// nothing. This is that row, written by both paths:
//   · type 'income', source 'grant', grant_id set (uq_fin_txns_grant: one row
//     per grant, whatever presses the button twice);
//   · the account: the org's grants revenue account, contributions (4010) when
//     it has none (ensureOrgLedger);
//   · the fund: one named for the funder or the program, else the org's first
//     unrestricted fund, the old path's rule;
//   · the date: the org's today when the award is recorded. A promise to give
//     is income when it is made (unconditional promises, ASC 958-605), which is
//     the rule the old path followed.
// The award route calls it inside the same transaction as the pledge, so the
// two exist together or not at all. scripts/ops/ledger2-award-rows.js calls it
// for awards recorded without one.
"use strict";
const { newId } = require("../shared/newId");

// The fund an award's income lands in.
async function awardFundId(q, orgId, funder, program, genFundId) {
  const [m] = await q("SELECT id FROM fin_funds WHERE org_id=? AND (name ILIKE ? OR name ILIKE ?) LIMIT 1",
    [orgId, `%${funder || ""}%`, `%${program || ""}%`]);
  return (m && m.id) || genFundId;
}

// Writes the row unless the grant already has one. Returns { id, created }.
// `ledger` is ensureOrgLedger's answer, read before any transaction opens.
async function bookAwardIncome(q, { orgId, grantId, funder, program, amount, date, ledger, by }) {
  if (!by || !by.id) throw new Error("bookAwardIncome: the actor is required");
  const fundId = await awardFundId(q, orgId, funder, program, ledger.genFundId);
  const id = newId("ft");
  const made = await q(
    `INSERT INTO fin_transactions (id,org_id,date,description,vendor_donor,amount,type,account_id,fund_id,grant_id,source,created_by,created_by_name)
     VALUES (?,?,?,?,?,?,'income',?,?,?,'grant',?,?)
     ON CONFLICT (grant_id) WHERE grant_id IS NOT NULL DO NOTHING RETURNING id`,
    [id, orgId, date, `Grant awarded: ${funder} · ${program || ""}`, funder,
     Number(amount) || 0, ledger.grantAcctId, fundId, grantId, by.id, by.name || by.id]);
  return { id: made.length ? made[0].id : null, created: made.length > 0 };
}

// Awards with a pledge (recorded through the award route) and no ledger row.
async function awardsWithoutIncome(q, orgId = null) {
  return q(
    `SELECT g.id, g.org_id, g.funder, g.program, g.amount_awarded, g.awarded_at, g.award_pledge_id
       FROM grants g
      WHERE g.award_pledge_id IS NOT NULL AND g.awarded_at IS NOT NULL
        AND COALESCE(g.amount_awarded, 0) > 0
        AND (?::text IS NULL OR g.org_id = ?)
        AND NOT EXISTS (SELECT 1 FROM fin_transactions t WHERE t.org_id = g.org_id AND t.grant_id = g.id)
      ORDER BY g.org_id, g.awarded_at, g.id`, [orgId, orgId]);
}

module.exports = { bookAwardIncome, awardsWithoutIncome, awardFundId };
