// server/donors/touchUndo.js · UNDO-1 item 4. LOGGING A TOUCH SAYS WHAT IT CLOSED, AND UNDO OPENS IT AGAIN.
//
// "logging a touch silently completes the open next step" (fleet, 22 Nov)
//
// A touch logged with a next step closes the person's open step (SENDS-1,
// server/tasks/logClose.js). The Log a touch dialog now says so before she
// saves ("This closes the next step: Call about the spring visit.") and lets
// her keep it open (`keepOpen`). When it does close one, that close, the new
// step the touch opened and any journey move are recorded (write_effects), and
// Recent changes shows "Logged a call with …; it closed …" with Undo:
//   POST /touches/:id/undo  takes the effects back newest first (the journey,
//   the new step, then the closed step reopens) and moves the touch line to
//   the trash, where it can be brought back. A touch that carried a gift keeps
//   its line: the gift is money and is changed from the gift.
"use strict";

const express = require("express");
const WE = require("../effects/writeEffects");
const PE = require("../effects/planEffects");

const routers = { r1: express.Router() };
const CLOSED_BEFORE = { closed_at: null, close_kind: null, close_reason: null, closing_interaction_id: null };

// After POST /donors/:id/conversations commits. `closedIds` are the steps the
// log closed, `openedId` the step it opened (not one it carried).
async function afterTouch(ctx, req, { donorId, interactionId, closedIds, openedId, kindLabel, closeTaskId = null }) {
  const { query, run, actor, advanceCultivationPlan } = ctx;
  const orgId = req.user.orgId, who = actor(req), db = { query, run };
  const parent = { orgId, kind: "touch", id: interactionId, donorId, who };
  // POLISH-11 item 1: her next step was a task and she chose Close it: the touch closes that task
  // too, recorded with the touch so its Undo opens it again.
  const task = closeTaskId ? (await query(`UPDATE tasks SET done = 1, completed_at = NOW(), completed_by_name = ?, updated_at = NOW()
      WHERE id = ? AND org_id = ? AND donor_id = ? AND COALESCE(done, 0) = 0 AND voided_at IS NULL RETURNING id, title`,
    [who.name, String(closeTaskId), orgId, donorId]))[0] || null : null;
  if (closedIds.length || task) {
    const closed = closedIds.length ? await query("SELECT id, next_step_label FROM threads WHERE org_id=? AND id = ANY(?::text[])", [orgId, closedIds]) : [];
    const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [donorId, orgId]);
    await WE.begin(db, { ...parent,
      sentence: `Logged a ${String(kindLabel || "touch").toLowerCase()} with ${(d && d.name) || "someone"}; it closed the next step: ${[...closed.map(c => c.next_step_label), ...(task ? [task.title] : [])].join(", ")}.`,
      undo: { label: "Undo", path: `/touches/${encodeURIComponent(interactionId)}/undo` } });
    for (const c of closed) await WE.record(db, parent, { kind: "step_closed", table: "threads", rowId: c.id, before: CLOSED_BEFORE });
    if (task) await WE.record(db, parent, { kind: "step_closed", table: "tasks", rowId: task.id, before: { done: 0, completed_at: null, completed_by_name: null } });
    if (openedId) await WE.record(db, parent, { kind: "step_opened", table: "threads", rowId: openedId, before: null });
  }
  // BUILD-99 Part 3: the plan moves on after the transaction, its changes recorded
  // against the step that closed (so a reopen by any door takes them back).
  return PE.advanceWithEffects(advanceCultivationPlan, parent, closedIds[0] || null, { actorId: who.id, actorName: who.name, today: ctx.today })
    .catch(e => console.error("[plan] advance:", e.message));
}

function mount(ctx) {
  const { query, run, requireAuth, checkWriteAccess, wrap, actor, trashRow } = ctx;
  // POLISH-11 item 1: the person's one open next step (a Thread step or a task), read by the
  // same rule as the profile (server/tasks/nextStep.js), for Log a touch's "This closes the next step".
  routers.r1.get("/donors/:id/next-step", requireAuth, wrap(async (req, res) => {
    const orgId = req.user.orgId, id = String(req.params.id);
    const [p] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [id, orgId]);
    if (!p) return res.status(404).json({ error: "not_found" });
    const today = await require("../../donorStatus").todayFor(orgId);
    const pick = (await require("../tasks/nextStep").nextStepsFor(query, orgId, [id], today)).get(id) || null;
    res.json({ step: pick ? { kind: pick.kind, id: pick.id, taskId: pick.taskId || null, label: pick.label, due: pick.due || null } : null });
  }));
  routers.r1.post("/touches/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId, who = actor(req), db = { query, run };
    const [h] = await query(`SELECT * FROM write_effects WHERE org_id=? AND parent_kind='touch' AND parent_id=? AND kind='write' ORDER BY created_at DESC LIMIT 1`, [orgId, req.params.id]);
    if (!h || h.undone_at) return res.status(404).json({ error: "not_found", sentence: h ? "That touch was already undone." : "There is nothing to undo for that touch." });
    const back = await WE.reverse(db, orgId, { parentKind: "touch", parentId: req.params.id }, who, { reason: "touch undone" });
    const [i] = await query("SELECT id, gift_id FROM interactions WHERE id=? AND org_id=?", [req.params.id, orgId]);
    let lineWords = "";
    if (i && !i.gift_id) { await trashRow("interactions", i.id, req); lineWords = " The touch is in Recent changes if you want it back."; }
    else if (i) lineWords = " The touch stays on the timeline because it recorded a gift.";
    await WE.finish(db, orgId, "touch", req.params.id, who, "undone");
    const reopened = back.filter(r => r.kind === "step_closed" && r.ok).length;
    const kept = WE.keptSentence(back);
    res.json({ ok: true, reopened, results: back,
      sentence: `${reopened ? "The next step it closed is open again." : "The touch is taken back."}${kept ? " " + kept : ""}${lineWords}` });
  }));
  return {};
}

module.exports = { routers, mount, afterTouch };
