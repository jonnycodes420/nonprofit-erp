// server/majorGifts/planStop.js · FLOWS-10 item 4 (W-1113-Fundraising-29X). STOPPING ONE PERSON'S
// JOURNEY SKIPS WHAT IS LEFT; IT NEVER MARKS A STEP DONE.
//
// Verity Underhill's "Mail a birthday card" read Done after Stop. POST /plans/:id/stop closed the
// open step's Thread as dismissed, and the person's Tasks read any closed task as done
// (client/src/lib/taskRow.js), so the profile said "Done Nov 13." for a step nobody did; the
// steps not yet open stayed "pending" under a stopped journey. The batch Undo already removed the
// open step's Thread (and its task with it); a single Stop now does the same, every step not done
// is skipped with the words "Skipped, journey stopped", and Stop has an Undo like the batch path.
"use strict";

const SKIPPED = "Skipped, journey stopped";
const UNDO_MINUTES = 10;
const PLANT = process.env.TEST_MODE === "1" ? String(process.env.FLOWS10_PLANT || "") : "";   // FLOWS-10: tests/flows10.test.js plants defects; never set outside tests

async function stopPlan({ query, run, actor }, req, res) {
  const orgId = req.user.orgId;
  const [p] = await query("SELECT * FROM cultivation_plans WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!p) { res.status(404).json({ error: "Plan not found" }); return null; }
  if (p.status !== "active") { res.status(409).json({ error: "That plan is not active." }); return null; }
  const who = actor(req);
  const left = await query("SELECT id, thread_id, status FROM cultivation_plan_steps WHERE plan_id=? AND org_id=? AND status IN ('open','pending')", [p.id, orgId]);
  if (PLANT === "stopdone") {   // the defect before FLOWS-10: the open step's Thread closed (its task reads Done), the rest left pending
    const open = left.find(s => s.status === "open");
    if (open && open.thread_id) await run("UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='handled_outside' WHERE id=? AND org_id=? AND closed_at IS NULL", [open.thread_id, orgId]);
    if (open) await run("UPDATE cultivation_plan_steps SET status='skipped', closed_at=NOW() WHERE id=?", [open.id]);
    await run("UPDATE cultivation_plans SET status='abandoned', closed_at=NOW() WHERE id=? AND org_id=?", [p.id, orgId]);
    return { plan: p, skipped: open ? 1 : 0, undoMinutes: UNDO_MINUTES, sentence: "Stopped." };
  }
  const threads = left.filter(s => s.status === "open" && s.thread_id).map(s => s.thread_id);
  // The open step's Thread goes, and its task with it (the thread's trigger), as the batch Undo does.
  if (threads.length) await run("DELETE FROM threads WHERE org_id=? AND id = ANY(?::text[]) AND closed_at IS NULL", [orgId, threads]);
  if (left.length) await run(`UPDATE cultivation_plan_steps SET status='skipped', closed_at=NOW(), closed_by=?, closed_by_name=?, skip_reason=?, thread_id=NULL
                               WHERE org_id=? AND id = ANY(?::text[])`, [who.id, who.name, SKIPPED, orgId, left.map(s => s.id)]);
  await run("UPDATE cultivation_plans SET status='abandoned', closed_at=NOW(), end_reason='stopped' WHERE id=? AND org_id=?", [p.id, orgId]);
  return { plan: p, skipped: left.length, undoMinutes: UNDO_MINUTES,
    sentence: `Stopped ${p.template_name || "the journey"}. ${left.length === 1 ? "1 step" : `${left.length} steps`} not done ${left.length === 1 ? "is" : "are"} skipped; the steps already done stay done.` };
}

// Undo, within UNDO_MINUTES: the journey runs again and its next step opens on the Thread.
async function undoStop({ query, run, advance, actor }, req, res) {
  const orgId = req.user.orgId;
  const [p] = await query("SELECT * FROM cultivation_plans WHERE id=? AND org_id=?", [req.params.id, orgId]);
  if (!p) { res.status(404).json({ error: "Plan not found" }); return null; }
  if (p.status !== "abandoned" || p.end_reason !== "stopped") { res.status(409).json({ error: "not_stopped", sentence: "This journey was not stopped, so there is nothing to undo." }); return null; }
  if (!p.closed_at || Date.now() - new Date(p.closed_at).getTime() > UNDO_MINUTES * 60000) { res.status(409).json({ error: "too_late", sentence: `A stop can be undone for ${UNDO_MINUTES} minutes. Start the journey again instead.` }); return null; }
  const [live] = await query("SELECT id FROM cultivation_plans WHERE org_id=? AND donor_id=? AND template_id=? AND status='active' AND id<>?", [orgId, p.donor_id, p.template_id, p.id]);
  if (live) { res.status(409).json({ error: "already_in", sentence: "They are already in this journey again, so the stop stays." }); return null; }
  await run(`UPDATE cultivation_plan_steps SET status='pending', closed_at=NULL, closed_by=NULL, closed_by_name=NULL, skip_reason=NULL, thread_id=NULL
              WHERE org_id=? AND plan_id=? AND status='skipped' AND skip_reason=?`, [orgId, p.id, SKIPPED]);
  await run("UPDATE cultivation_plans SET status='active', closed_at=NULL, end_reason=NULL WHERE id=? AND org_id=?", [p.id, orgId]);
  const who = actor(req);
  await advance(orgId, p.donor_id, { actorId: who.id, actorName: who.name });
  return { sentence: `${p.template_name || "The journey"} is running again.` };
}

module.exports = { stopPlan, undoStop, SKIPPED, UNDO_MINUTES };
