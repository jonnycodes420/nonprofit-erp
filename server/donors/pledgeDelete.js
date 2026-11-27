// server/donors/pledgeDelete.js · NUMBERS-10 item 6 (W-1127-Finance-03). WHETHER A PLEDGE CAN BE DELETED, SAID BEFORE THE CONFIRM.
//
// "Delete on a written-off $1,200 pledge opens a dialog promising removal, confirms with no feedback,
// and the pledge is still there after reload." FIX-14 made the server refuse a pledge with payments
// (409, FRESH-3 worded it for a written-off one), but the profile asked "Delete this pledge? It comes off
// this person's record" first and then put the refusal in a browser alert, which a walk (and a person who
// clicks past it) never reads. Staging's Harborlight: both $1,200 written-off pledges carry a payment.
//
// One rule, read twice: GET /donors/:id/pledges gives each pledge its `deleteRefusal` (the sentence, or
// null), so the × opens the refusal instead of the confirm; DELETE /pledges/:id refuses with the same
// sentence. A pledge with no payment is deleted to the trash (Undo, with its schedule and audit row).
"use strict";

// SQL: payments applied to pledge rows, by pledge (args: org, org, pledge ids). A payment is a gift
// naming the pledge, or a paid installment.
const PAID_N_SQL = `SELECT x.pledge_id, SUM(x.n)::int AS n FROM (
    SELECT pledge_id, COUNT(*)::int AS n FROM gifts WHERE org_id = ? AND pledge_id = ANY(?::text[]) GROUP BY pledge_id
    UNION ALL
    SELECT pledge_id, COUNT(*)::int FROM pledge_installments WHERE org_id = ? AND pledge_id = ANY(?::text[]) AND paid_gift_id IS NOT NULL GROUP BY pledge_id
  ) x GROUP BY x.pledge_id`;

// The sentence that says why this pledge stays, or null when it can be deleted.
function deleteRefusal(p, payments) {
  if (!(Number(payments) > 0)) return null;
  const n = Number(payments), them = n === 1 ? "the payment is a real gift" : "the payments are real gifts";
  return p && p.status === "written_off"
    ? `This pledge can't be deleted: it has ${n === 1 ? "a payment" : `${n} payments`} applied to it, so it stays on the record (${them}). It is already written off, so nothing more is expected on it.`
    : `This pledge can't be deleted: it has ${n === 1 ? "a payment" : `${n} payments`} applied to it (${them}). Write it off instead, and nothing more is expected on it.`;
}

// Map pledgeId -> payments applied.
async function paymentsByPledge(query, orgId, ids) {
  const out = new Map();
  if (!ids || !ids.length) return out;
  for (const r of await query(PAID_N_SQL, [orgId, ids, orgId, ids])) out.set(r.pledge_id, Number(r.n) || 0);
  return out;
}

module.exports = { deleteRefusal, paymentsByPledge, PAID_N_SQL };
