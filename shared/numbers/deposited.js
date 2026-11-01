// shared/numbers/deposited.js · NUMBERS-3. WHAT "DEPOSITED" MEANS, ONCE.
//
// A gift is deposited when a deposit run holds it (an `imports` row with
// shape 'deposit' that was not undone, BUILD-88b) or a day it reached the bank
// is recorded (`gifts.deposited_on`: a payout's arrival, or FIX-59's "They
// were already deposited"). That is TRUTH-1's definition 1, and Finance, month
// close, the bookkeeper's file, the deposits file and QuickBooks' deposit mode
// all read it from here.
//
// `deposit_ref` NAMES a deposit when the bank line is known (a payout id, or
// `sheet:<date>`). It is not what makes a gift deposited. DEPOSIT_NAME() is the
// name the files and QuickBooks group by: the ref when there is one, else the
// run that holds it, else the day it reached the bank. A deposited gift always
// has a name, so it is never "not matched to a deposit".
//
// Banked money is a cheque, cash, a bank transfer or ACH. One list: month
// close used to leave out bank transfer and ACH and add blank and unknown;
// it now reads this, the list Finance and the truth key use.
"use strict";

const BANKED_METHODS = ["check", "cheque", "cash", "bank transfer", "ach"];
const UNDEPOSITED_DAYS = 90;

const ON_RUN = (g = "g") => `EXISTS (SELECT 1 FROM imports im WHERE im.id = ${g}.import_id AND im.org_id = ${g}.org_id
                              AND im.shape = 'deposit' AND im.reversed_at IS NULL)`;
// SQL: gift `g` is deposited / on no deposit.
const DEPOSITED = (g = "g") => `(${ON_RUN(g)} OR COALESCE(${g}.deposited_on, '') <> '')`;
const NOT_DEPOSITED = (g = "g") => `(NOT ${ON_RUN(g)} AND COALESCE(${g}.deposited_on, '') = '')`;
// SQL: gift `g` came in as money somebody banks.
const BANKED = (g = "g") => `lower(trim(COALESCE(${g}.payment_method, ''))) IN (${BANKED_METHODS.map(m => `'${m}'`).join(", ")})`;
// SQL: the deposit's name, or '' when it is on none.
const DEPOSIT_NAME = (g = "g") => `COALESCE(NULLIF(${g}.deposit_ref, ''),
    CASE WHEN ${ON_RUN(g)} THEN 'deposit run ' || ${g}.import_id END,
    CASE WHEN COALESCE(${g}.deposited_on, '') <> '' THEN 'deposited ' || LEFT(${g}.deposited_on, 10) END, '')`;

// The same rules over a row already read: { deposit_ref, deposited_on, on_run, payment_method }.
const isDeposited = r => !!(r && (r.on_run || String(r.deposited_on || r.depositedOn || "").trim()));
const isBanked = r => BANKED_METHODS.includes(String((r && (r.payment_method ?? r.method)) || "").trim().toLowerCase());
function depositName(r) {
  const ref = String((r && (r.deposit_ref || r.depositRef)) || "").trim();
  if (ref) return ref;
  if (r && r.on_run && r.import_id) return `deposit run ${r.import_id}`;
  const on = String((r && (r.deposited_on || r.depositedOn)) || "").trim();
  return on ? `deposited ${on.slice(0, 10)}` : "";
}

module.exports = { BANKED_METHODS, UNDEPOSITED_DAYS, ON_RUN, DEPOSITED, NOT_DEPOSITED, BANKED, DEPOSIT_NAME, isDeposited, isBanked, depositName };
