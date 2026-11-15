// server/finance/ledgerLines.js · FLOWS-11 (W-1114-Finance-05X). TRANSACTIONS SHOWS A SPLIT GIFT
// AS ITS FUNDS.
//
// A $200 gift split $120 General Operating and $80 Scholarship Fund is one ledger row, stamped on
// the gift's largest line's fund (GIFTS-2). Fund Balances reads the ledger through
// fundLines.LEDGER_FUND_ROWS, which cuts that row by its lines; Transactions read the raw row, so
// it said "+$200 General Operating" and a fund filter could never foot to the fund's balance.
// Transactions now reads the same cut: one line per fund, each carrying the row it belongs to
// (`split_lines`, `row_amount`), so the screen groups them under the one gift.
"use strict";
const { LEDGER_FUND_ROWS } = require("../../shared/numbers/fundLines");

// GET /finance/transactions's rows. `year` a calendar year, or "all"/empty for every year.
async function transactionLines(query, orgId, { year, fund, account, donor } = {}) {
  const args = [orgId, orgId];
  let where = "";
  const y = parseInt(year, 10);
  if (y) { where += " AND ft.date >= ? AND ft.date <= ?"; args.push(`${y}-01-01`, `${y}-12-31`); }
  if (fund) { where += " AND l.fund_id = ?"; args.push(fund); }
  if (account) { where += " AND ft.account_id = ?"; args.push(account); }
  if (donor) { where += " AND ft.donor_id = ?"; args.push(donor); }
  return query(
    `SELECT ft.id, ft.org_id, ft.date, ft.description, ft.vendor_donor, l.amount, ft.type, ft.account_id, l.fund_id,
            ft.notes, ft.receipt_url, ft.created_at, ft.is_sample, ft.donor_id, ft.source, ft.gift_id, ft.grant_id,
            ft.created_by, ft.created_by_name,
            a.code AS account_code, a.name AS account_name, a.type AS account_type,
            f.name AS fund_name, f.restricted AS fund_restricted,
            ft.amount AS row_amount,
            CASE WHEN ft.gift_id IS NULL THEN 1 ELSE GREATEST(1, (SELECT COUNT(*) FROM gift_fund_lines gl WHERE gl.gift_id = ft.gift_id AND gl.org_id = ft.org_id))::int END AS split_lines
       FROM ${LEDGER_FUND_ROWS("?")} l
       JOIN fin_transactions ft ON ft.id = l.id AND ft.org_id = l.org_id
       LEFT JOIN accounts a ON a.id = ft.account_id
       LEFT JOIN fin_funds f ON f.id = l.fund_id
      WHERE ft.org_id = l.org_id${where}
      ORDER BY ft.date DESC NULLS LAST, ft.created_at DESC, ft.id, l.amount DESC, l.fund_id`, args);
}

module.exports = { transactionLines };
