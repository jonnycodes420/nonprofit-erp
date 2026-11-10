// shared/numbers/pledgeSchedule.js · TRUTH-5 (W-1107-Finance-20). A PLEDGE'S
// SCHEDULE, WITH EACH PAYMENT ON THE INSTALLMENT IT PAID.
//
// Lavinia's $1,200 pledge was made before installments existed: it has no
// pledge_installments rows, so her sidebar showed no schedule, and her two
// $300 payments mapped to no installment. The rule:
//   · a pledge with installments shows them, in due order;
//   · a pledge with none is ONE installment of its whole amount, due on the
//     pledge's own due date ("1 installment, $1,200, paid $600");
//   · payments (gifts linked to the pledge, money.js: a refund comes off, a
//     credit row pays nothing) are applied oldest first to the earliest
//     installment with something left (pledges.js installmentsLeft's order),
//     so each payment names the installment it paid, split when it spans two.
// Nothing is written: the schedule is read, so a pledge from before
// installments needs no repair.
"use strict";

const c = v => Math.round((Number(v) || 0) * 100);
const dueKey = i => `${i.dueDate ? String(i.dueDate).slice(0, 10) : "9999-99-99"}|${String(i.seq == null ? "" : i.seq).padStart(6, "0")}`;
const usd = cents => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });

// pl: { amount, dueDate, installments: [{ seq, dueDate, amount }] }
// payments: [{ id, date, amount }] (dollars; a refund negative).
// -> { legacy, installments: [{ seq, dueDate, amount, paidAmount, left, paid, payments: [{ giftId, date, amount }] }], paidAmount, words }
function scheduleOf(pl, payments = []) {
  const own = (pl.installments || []).map(i => ({ seq: i.seq, dueDate: i.dueDate ? String(i.dueDate).slice(0, 10) : null, cents: c(i.amount) }));
  const legacy = own.length === 0;
  const list = legacy ? [{ seq: 1, dueDate: pl.dueDate ? String(pl.dueDate).slice(0, 10) : null, cents: c(pl.amount) }] : own;
  const order = list.map((_, k) => k).sort((a, b) => (dueKey(list[a]) < dueKey(list[b]) ? -1 : dueKey(list[a]) > dueKey(list[b]) ? 1 : a - b));
  const pays = (payments || []).map(p => ({ id: p.id, date: p.date ? String(p.date).slice(0, 10) : "", cents: c(p.amount) }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  // A refund takes its money off the payments before it, newest first.
  const net = [];
  for (const p of pays) {
    if (p.cents >= 0) { net.push({ ...p }); continue; }
    let back = -p.cents;
    for (let k = net.length - 1; k >= 0 && back > 0; k--) { const t = Math.min(net[k].cents, back); net[k].cents -= t; back -= t; }
  }
  const got = list.map(() => ({ cents: 0, payments: [] }));
  let k = 0;
  for (const p of net) {
    let rest = p.cents;
    while (rest > 0 && k < order.length) {
      const j = order[k], room = list[j].cents - got[j].cents;
      if (room <= 0) { k++; continue; }
      const use = Math.min(room, rest);
      got[j].cents += use; got[j].payments.push({ giftId: p.id, date: p.date, amount: use / 100 });
      rest -= use;
      if (got[j].cents >= list[j].cents) k++;
    }
  }
  const installments = list.map((i, j) => ({ seq: i.seq, dueDate: i.dueDate, amount: i.cents / 100, paidAmount: got[j].cents / 100,
    left: Math.max(0, i.cents - got[j].cents) / 100, paid: got[j].cents >= i.cents && i.cents > 0, payments: got[j].payments }));
  const paidCents = got.reduce((n, g) => n + g.cents, 0);
  const n = installments.length;
  return { legacy, installments, paidAmount: paidCents / 100,
    words: `${n} ${n === 1 ? "installment" : "installments"}, ${usd(c(pl.amount))}, paid ${usd(paidCents)}` };
}

// SQL: each pledge's payments, oldest first. Placeholders: org, pledge ids.
const PAYMENTS_SQL = () => {
  const { MONEY } = require("./money");
  return `SELECT g.pledge_id, g.id, LEFT(g.date, 10) AS date, g.amount::float AS amount FROM gifts g
           WHERE g.org_id = ? AND g.pledge_id = ANY(?) AND ${MONEY("g")} ORDER BY g.pledge_id, g.date, g.id`;
};

const SENTENCE = "A pledge's schedule: its installments in due order (one, of the whole amount, for a pledge made before installments), each payment applied oldest first to the earliest installment with something left.";

module.exports = { scheduleOf, PAYMENTS_SQL, SENTENCE };
