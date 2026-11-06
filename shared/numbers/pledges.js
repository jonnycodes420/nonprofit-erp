// shared/numbers/pledges.js · NUMBERS-4. WHAT A PLEDGE HAS BEEN PAID, ONCE.
//
// A pledge is paid by gifts linked to it (gifts.pledge_id), and a gift is
// money (money.js): a soft or matching credit row linked to a pledge is
// recognition and pays nothing; a refund of a payment comes off. About twenty
// places wrote their own "paid" (docs/architecture/money-sums.md), every one
// counting credit rows. They read these two fragments now.
//
// LEDGER-1 · WHAT IS DUE, ONCE. A pledge's balance is its amount less what has
// been paid on it. What is due by a day is what the schedule asked for by that
// day, less what has been paid, never more than the balance: a $1,200 pledge
// with one $1,200 installment and a $300 payment has $900 due, $900 overdue
// once the day passes, and $900 still to come. The installments' own paid
// flags (pledge_installments.paid_gift_id) count as paid too, so a payment
// matched to an installment and one that was not are the same money.
// `dueOf` is the rule for one pledge (the Pledges rows, the profile);
// `DUE_SQL` is the same rule for the figure sources (pledges-due, -overdue).
"use strict";
const { MONEY } = require("./money");

// Each pledge's paid, as a joinable set: (pledge_id, paid). One `?`: the org.
const PAID_BY_PLEDGE = `(SELECT ppg.pledge_id, SUM(ppg.amount) AS paid FROM gifts ppg
    WHERE ppg.org_id = ? AND ppg.pledge_id IS NOT NULL AND ${MONEY("ppg")} GROUP BY ppg.pledge_id)`;
// Pledge `p`'s paid, correlated (no placeholders).
const PAID_OF = (p = "p") => `(SELECT COALESCE(SUM(ppg.amount), 0) FROM gifts ppg
    WHERE ppg.pledge_id = ${p}.id AND ppg.org_id = ${p}.org_id AND ${MONEY("ppg")})`;

// What grant `gr` has received (NUMBERS-5): the money paid on its award pledge,
// correlated. grantMoneyRows (the restricted balance, the grant pages) and the
// report builder's Received read it.
const GRANT_RECEIVED = (gr = "gr") => `(SELECT COALESCE(SUM(ppg.amount), 0) FROM gifts ppg
    WHERE ppg.pledge_id = ${gr}.award_pledge_id AND ppg.org_id = ${gr}.org_id AND ${MONEY("ppg")})`;

// One pledge: { amount, paid, dueDate, installments: [{ dueDate, amount, paid }] },
// due by `day` (op "<=") or before it (op "<"). Dollars in, dollars out.
const c = v => Math.round((Number(v) || 0) * 100);
const cmp = (d, day, op) => !!d && (op === "<" ? String(d).slice(0, 10) < day : String(d).slice(0, 10) <= day);
// MONEY-3 · WHAT IS STILL TO COME on one pledge, in cents: its amount less
// what has been paid on it (PAID_OF), never below zero. Home's pledge move
// (insights.js) and dueOf read it; the profile's balance is the same sum.
const balanceCents = pl => Math.max(0, c(pl.amount) - c(pl.paid));
function dueOf(pl, day, op = "<=") {
  const balance = balanceCents(pl);
  const list = pl.installments || [];
  if (!list.length) {
    const d = pl.dueDate ? String(pl.dueDate).slice(0, 10) : "";
    return (op === "<=" ? (!d || d <= day) : (d && d < day)) ? balance / 100 : 0;
  }
  const covered = Math.max(c(pl.paid), list.filter(i => i.paid).reduce((n, i) => n + c(i.amount), 0));
  const sched = list.filter(i => cmp(i.dueDate, day, op)).reduce((n, i) => n + c(i.amount), 0);
  return Math.min(balance, Math.max(0, sched - covered)) / 100;
}
// What is left on each installment, the payments applied earliest first (the
// chips under a pledge row): an installment is open only while something is left on it.
function installmentsLeft(pl) {
  const list = pl.installments || [];
  let covered = Math.max(c(pl.paid), list.filter(i => i.paid).reduce((n, i) => n + c(i.amount), 0));
  return list.map(i => { const a = c(i.amount), use = Math.min(a, covered); covered -= use; return { ...i, left: (a - use) / 100 }; });
}
// The same rule in SQL, one row per open pledge with a schedule that has
// something due: (id, donor_id, name, date, amount). `op` is "<=" or "<".
// Placeholders, in order: org, day, day, org, org.
const DUE_SQL = (op) => `SELECT x.id, x.donor_id, x.name, x.date, x.amount FROM (
    SELECT p.id, p.donor_id, d.name, s.first_due AS date,
           ROUND(LEAST(GREATEST(p.amount - COALESCE(pp.paid, 0), 0),
                       GREATEST(s.sched - GREATEST(COALESCE(pp.paid, 0), s.covered), 0))::numeric, 2) AS amount
      FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
      LEFT JOIN ${PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
      JOIN (SELECT i.pledge_id, COALESCE(SUM(i.amount) FILTER (WHERE i.due_date ${op} ?), 0) AS sched,
                   COALESCE(SUM(i.amount) FILTER (WHERE i.paid_gift_id IS NOT NULL), 0) AS covered,
                   MIN(i.due_date) FILTER (WHERE i.due_date ${op} ?) AS first_due
              FROM pledge_installments i WHERE i.org_id = ? GROUP BY i.pledge_id) s ON s.pledge_id = p.id
     WHERE p.org_id = ? AND p.status = 'open' AND d.deleted_at IS NULL) x
   WHERE x.amount > 0`;

module.exports = { PAID_BY_PLEDGE, PAID_OF, GRANT_RECEIVED, balanceCents, dueOf, installmentsLeft, DUE_SQL };
