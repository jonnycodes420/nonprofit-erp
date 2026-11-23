// server/tasks/threadDone.js · FLOWS-1 item 12. MARK DONE MARKS IT DONE.
//
// Home's "Done" on a next step always opened the Log a call dialog: a step
// could only be finished by logging a conversation. Now Done closes the step
// as done (close_kind 'dismissed' with close_reason 'done', which the
// threads_close_honest check allows: a decision, with its reason on the row),
// and logging a call is an optional link beside it. Like a dismissal, a done
// step moves a journey's plan on. Undo reopens the step while nothing has
// been logged on it since.
//
// UNDO-1 item 3: the journey move is recorded (server/effects/planEffects.js)
// and Undo takes it back before the step reopens; the Done is a line in
// Recent changes with that same Undo.
"use strict";

const WE = require("../effects/writeEffects");
const PE = require("../effects/planEffects");

function register(app, { query, run, wrap, requireAuth, checkWriteAccess, actor, advanceCultivationPlan }) {
  app.post("/threads/:id/done", requireAuth, checkWriteAccess, wrap(async (req, res) => {
    const { orgId } = req.user;
    const who = actor(req);
    const db = { query, run };
    const [t] = await query("SELECT id, donor_id, next_step_label, closed_at, close_kind, close_reason, closing_interaction_id FROM threads WHERE id=? AND org_id=?", [req.params.id, orgId]);
    if (!t) return res.status(404).json({ error: "not_found", sentence: "That next step is no longer here." });
    if (req.body && req.body.done === false) {
      if (!t.closed_at) return res.json({ ok: true, reopened: false });
      if (t.close_reason !== "done" || t.closing_interaction_id) return res.status(409).json({ error: "not_undoable", sentence: "That step was closed another way, so it stays closed." });
      const back = await PE.reverseForThread(db, orgId, t.id, who);
      try {
        await run("UPDATE threads SET closed_at=NULL, close_kind=NULL, close_reason=NULL WHERE id=? AND org_id=?", [t.id, orgId]);
      } catch (e) {
        if (/threads_one_open|unique/i.test(e.message)) return res.status(409).json({ error: "step_replaced", sentence: "A newer next step is already open for this person, so this one stays done." });
        throw e;
      }
      await WE.finish(db, orgId, "thread_done", t.id, who, "reopened");
      const kept = WE.keptSentence(back);
      return res.json({ ok: true, reopened: true, journeyBack: back.filter(r => r.ok && r.kind === "journey_completed").length,
        sentence: `${t.next_step_label} is open again.${back.some(r => r.ok && r.kind !== "step_opened") ? " Its journey is back where it was."
          : back.some(r => r.ok) ? " The journey step that opened after it is waiting again." : ""}${kept ? " " + kept : ""}` });
    }
    if (t.closed_at) return res.status(409).json({ error: "already_closed", sentence: "That step is already closed." });
    await run("UPDATE threads SET closed_at=NOW(), close_kind='dismissed', close_reason='done' WHERE id=? AND org_id=? AND closed_at IS NULL", [t.id, orgId]);
    const [d] = await query("SELECT name FROM donors WHERE id=? AND org_id=?", [t.donor_id, orgId]);
    const parent = { orgId, kind: "thread_done", id: t.id, donorId: t.donor_id, who };
    await WE.begin(db, { ...parent, sentence: `Marked done: ${t.next_step_label}${d && d.name ? ` for ${d.name}` : ""}.`,
      undo: { path: `/threads/${encodeURIComponent(t.id)}/done`, body: { done: false } } });
    await PE.advanceWithEffects(advanceCultivationPlan, parent, t.id, { actorId: who.id, actorName: who.name })
      .catch(e => console.error("[plan] advance:", e.message));
    res.json({ ok: true, sentence: `Done: ${t.next_step_label}.` });
  }));
}

module.exports = { register };
