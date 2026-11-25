// server/pledges/overdueNow.js · SENDS-3 item 1. THE REMINDER JOB ASKS THE ONE OVERDUE RULE.
//
// DEFINE-1 made "overdue" mean pledgeSchedule.overdueOf (an installment due
// before the org's today with something left on it) on every screen. The
// pledge reminder job still stamped `pledges.first_overdue_at` from the
// pledge's single due_date and sent off that stamp, so a pledge whose
// installments were all on time (or paid) could be reminded as "56d overdue"
// when nothing was due. This reads each pledge's schedule exactly as the
// profile does (installments, payments by PAYMENTS_SQL) and answers overdueOf.
//
// Read only. The job stamps and sends from this answer; the dry-run script
// (scripts/ops/sends3-pledge-stamps.js) lists stamps it disagrees with.
"use strict";

const PS = require("../../shared/numbers/pledgeSchedule");

const dollars = v => Math.round((parseFloat(v) || 0) * 100) / 100;

// pledges: [{ id, amount, due_date }] of ONE org. -> Map(id -> overdueOf result)
async function overdueByPledge(query, orgId, pledges, today) {
  const out = new Map();
  const list = (pledges || []).filter(p => p && p.id);
  if (!list.length) return out;
  const ids = list.map(p => p.id);
  const inst = await query(
    `SELECT pledge_id, seq, due_date, amount FROM pledge_installments WHERE org_id=? AND pledge_id = ANY(?) ORDER BY pledge_id, seq`,
    [orgId, ids]);
  const instBy = new Map();
  for (const i of inst) (instBy.get(i.pledge_id) || instBy.set(i.pledge_id, []).get(i.pledge_id))
    .push({ seq: i.seq, dueDate: i.due_date ? String(i.due_date).slice(0, 10) : null, amount: dollars(i.amount) });
  const payBy = new Map();
  for (const g of await query(PS.PAYMENTS_SQL(), [orgId, ids])) (payBy.get(g.pledge_id) || payBy.set(g.pledge_id, []).get(g.pledge_id)).push(g);
  for (const p of list) {
    const pl = { amount: dollars(p.amount), dueDate: p.due_date ? String(p.due_date).slice(0, 10) : "", installments: instBy.get(p.id) || [] };
    out.set(p.id, PS.overdueOf(PS.scheduleOf(pl, payBy.get(p.id) || []), today));
  }
  return out;
}

module.exports = { overdueByPledge };
