// shared/numbers/ledgerSpan.js · POLISH-14 item 4. THE LEDGER'S INCOME AND EXPENSE IN A SPAN.
//
// The board pack's Financial Snapshot reads it twice, over one rule: this fiscal
// year so far and last fiscal year whole, so a year-to-date tile and the full
// year beside it can never be two computations. A person in the trash takes
// their ledger rows with them (money.js LEDGER_LIVE).
"use strict";
const { LEDGER_LIVE } = require("./money");

// { income, expense } in dollars, for ledger rows dated from..to (civil days, inclusive).
async function ledgerByType(query, orgId, from, to) {
  const rows = await query(`SELECT type, SUM(amount) AS total FROM fin_transactions
                             WHERE org_id = ? AND date >= ? AND date <= ? AND ${LEDGER_LIVE("fin_transactions")} GROUP BY type`, [orgId, from, to]);
  const by = Object.fromEntries(rows.map(r => [r.type, parseFloat(r.total) || 0]));
  return { income: by.income || 0, expense: by.expense || 0 };
}

module.exports = { ledgerByType };
