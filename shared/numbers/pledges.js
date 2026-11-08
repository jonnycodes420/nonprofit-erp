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
// PLEDGES-3: "earliest" is the due date (then seq), whatever order the list
// came in; the answer keeps the list's own order, so callers may index it.
const dueKey = i => `${i.dueDate ? String(i.dueDate).slice(0, 10) : "9999-99-99"}|${String(i.seq == null ? "" : i.seq).padStart(6, "0")}`;
function installmentsLeft(pl) {
  const list = pl.installments || [];
  let covered = Math.max(c(pl.paid), list.filter(i => i.paid).reduce((n, i) => n + c(i.amount), 0));
  const left = new Array(list.length);
  list.map((i, k) => k).sort((a, b) => (dueKey(list[a]) < dueKey(list[b]) ? -1 : dueKey(list[a]) > dueKey(list[b]) ? 1 : a - b))
    .forEach(k => { const a = c(list[k].amount), use = Math.min(a, covered); covered -= use; left[k] = (a - use) / 100; });
  return list.map((i, k) => ({ ...i, left: left[k] }));
}
// WALKB-2 · HOW MANY INSTALLMENTS ARE STILL OPEN: the ones with something left
// on them once the payments are applied earliest first. The profile's open
// pledge said "1 more installment" with two unpaid (it counted the ones after
// the next); it says this count now.
const unpaidCount = pl => installmentsLeft(pl).filter(i => i.left > 0).length;
// WALKB-2 · "DUE THIS YEAR" IS THE FISCAL YEAR, SAID AS ONE. What falls due by
// the end of the org's fiscal year, less what has been applied (dueOf, to the
// day Home and Fundraising count to), never the balance. Its words name the
// year: "due in FY 2026–27", or "due in FY 2026" for a calendar-year org.
// `label` is shared/fiscalPeriod.js's fyLabelFromStart for the year.
function dueThisFiscalYear(pl, bounds, label) {
  return { amount: dueOf(pl, bounds.end, "<="), label: label || "", yearEnd: bounds.end };
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

// PLEDGES-3 · ONE PLEDGE, ONE READER (W-1107-Finance-20). Lavinia's one
// pledge read "$600 pledge, due Dec 15" in Fundraising's dialog, "next due
// Nov 3" on her profile and an unpaid-flag Nov 3 in Calendar, and no surface
// said what the next installment was. Every place a pledge appears says these
// five values, from here: pledged, received, open, and the NEXT installment's
// open amount and date (what is left on the earliest installment the payments
// have not covered, never the pledge total or the installment's face amount).
// A pledge with no schedule: next is its open balance on its own due date.
function summaryOf(pl) {
  const pledged = c(pl.amount) / 100, received = c(pl.paid) / 100, open = balanceCents(pl) / 100;
  const list = installmentsLeft(pl).filter(i => i.left > 0)
    .sort((a, b) => (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : 0));
  let nextAmount = 0, nextDue = null;
  if (open > 0 && list.length) { nextAmount = Math.min(list[0].left, open); nextDue = list[0].dueDate ? String(list[0].dueDate).slice(0, 10) : null; }
  else if (open > 0) { nextAmount = open; nextDue = pl.dueDate ? String(pl.dueDate).slice(0, 10) : null; }
  return { pledged, received, open, nextAmount, nextDue, words: summaryWords({ pledged, received, open, nextAmount, nextDue }) };
}
const usd = v => "$" + (Number(v) || 0).toLocaleString("en-US", { minimumFractionDigits: Math.round((Number(v) || 0) * 100) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const longDay = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || "")); return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
// The one sentence: "$1,200 pledged · $600 received · $600 open · next $300 due Nov 3, 2026".
function summaryWords(s) {
  const parts = [`${usd(s.pledged)} pledged`, `${usd(s.received)} received`, `${usd(s.open)} open`];
  if (s.open > 0) parts.push(s.nextDue ? `next ${usd(s.nextAmount)} due ${longDay(s.nextDue)}` : `next ${usd(s.nextAmount)}, no set date`);
  return parts.join(" · ");
}
// The same next installment in SQL, for pledge `p` (a LATERAL join, no
// placeholders): next_due (YYYY-MM-DD or NULL) and next_left, what is left on
// the earliest installment the payments have not covered. A pledge with no
// schedule gives no row; the reader falls back to its balance and due date.
const NEXT_INSTALLMENT = (p = "p") => `LEFT JOIN LATERAL (
    SELECT LEFT(x.due_date::text, 10) AS next_due, ROUND(LEAST(x.amount, x.cum - x.cov)::numeric, 2) AS next_left
      FROM (SELECT i.due_date, i.seq, i.amount,
                   SUM(i.amount) OVER (ORDER BY i.due_date NULLS LAST, i.seq, i.id) AS cum,
                   GREATEST(${PAID_OF(p)}, (SELECT COALESCE(SUM(f.amount), 0) FROM pledge_installments f
                       WHERE f.pledge_id = ${p}.id AND f.org_id = ${p}.org_id AND f.paid_gift_id IS NOT NULL)) AS cov
              FROM pledge_installments i WHERE i.pledge_id = ${p}.id AND i.org_id = ${p}.org_id) x
     WHERE x.cum > x.cov ORDER BY x.due_date NULLS LAST, x.seq LIMIT 1) nx ON TRUE`;
// summaryWords in SQL, for the figure rows (one sentence, the same words):
// each argument a SQL expression. `paid` and `amount` are dollars.
const usdSql = e => `('$' || CASE WHEN ROUND((${e})::numeric, 2) = TRUNC((${e})::numeric) THEN TO_CHAR((${e})::numeric, 'FM999,999,999,990') ELSE TO_CHAR((${e})::numeric, 'FM999,999,999,990.00') END)`;
const SUMMARY_WORDS_SQL = (amount, paid, p = "p") => {
  const open = `GREATEST(${amount} - ${paid}, 0)`;
  const nextAmt = `COALESCE(LEAST(nx.next_left, ${open}), ${open})`, nextDue = `COALESCE(nx.next_due, NULLIF(LEFT(${p}.due_date::text, 10), ''))`;
  return `(${usdSql(amount)} || ' pledged · ' || ${usdSql(paid)} || ' received · ' || ${usdSql(open)} || ' open'
    || CASE WHEN ${open} <= 0 THEN '' WHEN ${nextDue} IS NULL THEN ' · next ' || ${usdSql(nextAmt)} || ', no set date'
       ELSE ' · next ' || ${usdSql(nextAmt)} || ' due ' || TO_CHAR((${nextDue})::date, 'Mon FMDD, YYYY') END)`;
};
// PLEDGES-3 · THE FIGURE ROWS (figureSources.js pledges-due/-overdue and
// pledges-open), moved here beside the rule so the dialog's rows and the
// pledge reads cannot drift apart. The open/no-schedule pledges: what is
// still to come, by the pledge's own date.
function dueRowsSql(orgId, day, op) {
  // LEDGER-1: what the schedule asked for by the day, less what has been
  // paid, never more than the balance (shared/numbers/pledges.js DUE_SQL), so
  // a part-paid installment counts only what is left on it.
  const P = { DUE_SQL, PAID_BY_PLEDGE, SUMMARY_WORDS_SQL, NEXT_INSTALLMENT };
  // PLEDGES-3: each row is dated by the pledge's NEXT installment (what is
  // left on it, never a paid one) and says the five values in one sentence.
  return {
    sql: `SELECT due.id, 'pledge' AS type, due.donor_id, due.name, COALESCE(nx.next_due, LEFT(due.date::text, 10)) AS date, due.amount,
                 ${P.SUMMARY_WORDS_SQL("p.amount", "COALESCE(pq.paid, 0)")} AS detail
            FROM (${P.DUE_SQL(op)}) due
            JOIN pledges p ON p.id = due.id AND p.org_id = ?
            LEFT JOIN ${P.PAID_BY_PLEDGE.replace(/ppg/g, "pqg")} pq ON pq.pledge_id = p.id
            ${P.NEXT_INSTALLMENT("p")}
          UNION ALL
          SELECT p.id, 'pledge', p.donor_id, d.name, LEFT(p.due_date::text, 10), ROUND(GREATEST(p.amount - COALESCE(pp.paid, 0), 0)::numeric, 2),
                 ${P.SUMMARY_WORDS_SQL("p.amount", "COALESCE(pp.paid, 0)").replace(/nx\.next_left/g, "NULL::numeric").replace(/nx\.next_due/g, "NULL::text")}
            FROM pledges p JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
            LEFT JOIN ${P.PAID_BY_PLEDGE} pp ON pp.pledge_id = p.id
           WHERE p.org_id = ? AND p.status = 'open' AND d.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM pledge_installments i2 WHERE i2.pledge_id = p.id)
             AND (${op === "<=" ? "p.due_date IS NULL OR p.due_date = '' OR " : ""}LEFT(p.due_date::text, 10) ${op} ?)`,
    args: [orgId, day, day, orgId, orgId, orgId, orgId, orgId, orgId, day],
    order: "date ASC NULLS LAST, id",
  };
}

function openRowsSql(orgId, p) {
  return {
      // PLEDGES-3: dated by the next installment, with the five values said.
      sql: `SELECT p.id, 'pledge' AS type, p.donor_id, d.name, COALESCE(nx.next_due, p.due_date::text) AS date,
                   ROUND(GREATEST(p.amount - COALESCE(pp.paid, 0), 0)::numeric, 2) AS amount,
                   ${SUMMARY_WORDS_SQL("p.amount", "COALESCE(pp.paid, 0)")} AS detail
              FROM pledges p
              LEFT JOIN donors d ON d.id = p.donor_id AND d.org_id = p.org_id
              LEFT JOIN ${PAID_BY_PLEDGE} pp
                     ON pp.pledge_id = p.id
              ${NEXT_INSTALLMENT("p")}
             WHERE p.org_id = ? AND p.status = 'open' AND d.deleted_at IS NULL${p && p.campaign ? " AND p.campaign_id = ?" : ""}${p && p.donor ? " AND p.donor_id = ?" : ""}`,
      args: [orgId, orgId, ...(p && p.campaign ? [p.campaign] : []), ...(p && p.donor ? [p.donor] : [])],
      order: "date ASC NULLS LAST, id",
  };
}

// Every installment of an open pledge with something still left on it (the
// Calendar): (installment id, pledge id, due, amount, left). Placeholders: org.
const OPEN_INSTALLMENTS_SQL = `SELECT x.id, x.pledge_id, LEFT(x.due_date::text, 10) AS due, x.amount,
         ROUND(LEAST(x.amount, x.cum - x.cov)::numeric, 2) AS left_amount
    FROM (SELECT i.id, i.pledge_id, i.due_date, i.amount,
                 SUM(i.amount) OVER (PARTITION BY i.pledge_id ORDER BY i.due_date NULLS LAST, i.seq, i.id) AS cum,
                 GREATEST(${PAID_OF("p")}, (SELECT COALESCE(SUM(f.amount), 0) FROM pledge_installments f
                     WHERE f.pledge_id = p.id AND f.org_id = p.org_id AND f.paid_gift_id IS NOT NULL)) AS cov
            FROM pledge_installments i JOIN pledges p ON p.id = i.pledge_id AND p.org_id = i.org_id AND p.status = 'open'
           WHERE i.org_id = ?) x
   WHERE x.cum > x.cov`;

module.exports = { dueRowsSql, openRowsSql, summaryOf, summaryWords, SUMMARY_WORDS_SQL, NEXT_INSTALLMENT, OPEN_INSTALLMENTS_SQL, PAID_BY_PLEDGE, PAID_OF, GRANT_RECEIVED, balanceCents, dueOf, installmentsLeft, unpaidCount, dueThisFiscalYear, DUE_SQL };
