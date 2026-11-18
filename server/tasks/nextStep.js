// server/tasks/nextStep.js · EDIT-2. EACH PERSON'S NEXT STEP, READ ONCE.
//
// The candidates are every open step on the person: their open Thread step
// (threads, not closed) and their open tasks (not done, not voided). The rule
// that picks one is shared/nextStep.js. Major gifts, the Top 100, the profile
// header and Home all read the answer from here or from that rule, so a May
// task and a December task can't be two different "next steps" on two screens.
//
// A thread's own task (link_kind 'next_step') is that thread, and a grant
// deadline whose follow-up thread is open is that thread: each counts once,
// the same exclusions as the Thread's composer (server/tasks/routes.js).
"use strict";

let _rule = null;
const rule = async () => _rule || (_rule = await import("../../shared/nextStep.js"));

// → Map donorId → { kind: "thread"|"touch"|"task", id, taskId, type, label, due, time, overdue }
async function nextStepsFor(query, orgId, donorIds, today) {
  const ids = [...new Set((donorIds || []).filter(Boolean))];
  const byDonor = new Map();
  if (!ids.length) return new Map();
  const add = (donorId, c) => { if (!byDonor.has(donorId)) byDonor.set(donorId, []); byDonor.get(donorId).push(c); };
  for (const t of await query(
    `SELECT id, donor_id, next_step_label, next_step_type, due_date, due_time
       FROM threads WHERE org_id = ? AND donor_id = ANY(?::text[]) AND closed_at IS NULL`, [orgId, ids]))
    add(t.donor_id, { kind: "thread", id: t.id, taskId: null, type: t.next_step_type || null, label: t.next_step_label,
      due: String(t.due_date || "").slice(0, 10), time: t.due_time || null });
  for (const k of await query(
    `SELECT k.id, k.donor_id, k.title, k.type, k.touch_type, k.care_plan_id, k.due, k.due_time
       FROM tasks k
      WHERE k.org_id = ? AND k.donor_id = ANY(?::text[]) AND COALESCE(k.done, 0) = 0 AND k.voided_at IS NULL
        AND COALESCE(k.link_kind, '') <> 'next_step'
        AND NOT EXISTS (SELECT 1 FROM grant_milestones m JOIN threads th ON th.id = m.thread_id AND th.closed_at IS NULL
                         WHERE m.id = k.milestone_id AND m.org_id = k.org_id AND k.link_kind = 'deadline')`, [orgId, ids]))
    add(k.donor_id, { kind: k.care_plan_id ? "touch" : "task", id: k.id, taskId: k.id, type: k.care_plan_id ? k.touch_type : (k.type || "task"),
      label: k.title, due: String(k.due || "").slice(0, 10), time: k.due_time || null });
  const { pickNextStep } = await rule();
  const out = new Map();
  for (const [donorId, cs] of byDonor) {
    // Ties on the day: the Thread step first, then the steadier id order.
    cs.sort((a, b) => (a.kind === b.kind ? String(a.id).localeCompare(String(b.id)) : a.kind === "thread" ? -1 : b.kind === "thread" ? 1 : 0));
    const pick = pickNextStep(cs, today);
    if (pick) out.set(donorId, pick);
  }
  return out;
}

// The Thread's rows for one person (Home) or a profile (the rail), with the
// next step first. Each row carries nextStep.due. bySoon: the rest soonest
// first (the rail); otherwise the rest keep the order they came in.
async function leadWithNext(rows, today, { bySoon = false } = {}) {
  if (!rows || rows.length < 2) return rows || [];
  const order = bySoon ? [...rows].sort((a, b) => String(a.nextStep.due || "9999").localeCompare(String(b.nextStep.due || "9999"))
    || (a.kind === b.kind ? 0 : a.kind === "thread" ? -1 : 1)) : rows;
  const { pickNextStep } = await rule();
  const pick = pickNextStep(order.map(r => ({ r, due: r.nextStep && r.nextStep.due })), today);
  return pick ? [pick.r, ...order.filter(r => r !== pick.r)] : order;
}

module.exports = { nextStepsFor, leadWithNext };
