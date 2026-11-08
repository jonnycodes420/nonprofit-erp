// server/shared/grantMilestones.js — a grant milestone's row, done and reopened.
//
// SPLIT-1: moved VERBATIM from routes/crm.js. Nothing in it changed.
//
// routes/crm.js mounts it before the route modules, and what its mount()
// returns is on ctx for every module mounted after it.
// mount() runs once at the end of boot with server.js's ctx and what the helper
// modules hand back. A relative require() or import() reads from this folder.
// Tests read it through readSource("server.js") (scripts/lib/readSource.js).

function mount(ctx) {
const {
  grantMsMod, orgLeadDays, orgToday, orgTz, query, raiseGrantMilestone, run,
} = ctx;

function milestoneRow(r, M, today, leadDays) {
  const m = {
    id: r.id, grantId: r.grant_id, kind: r.kind, kindLabel: M.milestoneName(r), label: r.label || "",
    dueDate: r.due_date, state: r.state, threadId: r.thread_id || null,
    funderName: r.funder_name || r.funder || "", program: r.program || "",
    grantStatus: r.status || null, notes: r.notes || "",
    completedAt: r.completed_at || null, completedByName: r.completed_by_name || null,
  };
  const t = M.milestoneTiming(m, today);
  m.band = t.band; m.overdueDays = t.overdueDays; m.daysUntil = t.days; m.sentence = t.sentence;
  // PLEDGES-3: an awarded grant's application deadlines stop counting down (reports still count).
  if (M.applicationClosed && M.applicationClosed({ id: r.id, kind: r.kind }, r.status)) Object.assign(m, M.closedTiming(m));
  m.leadDays = M.leadDaysFor(r.kind, leadDays);
  if (r.state === "waiting") m.waitingSentence = M.waitingSentence(m);
  return m;
}

// FIX-31: the two ways a deadline's state changes, shared by its own routes
// and by its task (Tasks, the Calendar), so a tick anywhere is the same tick.
async function markMilestoneDone(orgId, msId, who) {
  const [u] = await query("SELECT name FROM users WHERE id=? AND org_id=?", [who.id, orgId]);
  await run(`UPDATE grant_milestones SET state='done', completed_at=NOW(),
               completed_by=?, completed_by_name=?, updated_at=NOW()
              WHERE id=? AND org_id=?`,
    [who.id, (u && u.name) || who.name, msId, orgId]);
}
async function reopenMilestone(orgId, ms, M) {
  M = M || await grantMsMod();
  let threadOpen = false;
  if (ms.thread_id) {
    const [t] = await query("SELECT id FROM threads WHERE id=? AND org_id=? AND closed_at IS NULL", [ms.thread_id, orgId]);
    threadOpen = !!t;
  }
  await run(`UPDATE grant_milestones SET state=?, thread_id=?, completed_at=NULL, completed_by=NULL, completed_by_name=NULL, updated_at=NOW()
              WHERE id=? AND org_id=?`, [threadOpen ? "raised" : "pending", threadOpen ? ms.thread_id : null, ms.id, orgId]);
  const org = await orgTz(orgId);
  const today = orgToday(org);                                  // ORG_TZ_SEAM_OK
  const leadDays = await orgLeadDays(orgId);
  if (!threadOpen && M.dueWithinLead({ kind: ms.kind, dueDate: ms.due_date }, today, leadDays)) {
    await raiseGrantMilestone(orgId, ms, { today });
  }
}
return { markMilestoneDone, milestoneRow, reopenMilestone };
}

module.exports = { mount };
