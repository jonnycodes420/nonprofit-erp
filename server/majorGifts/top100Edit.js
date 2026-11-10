// server/majorGifts/top100Edit.js · TOUCH-1. EDIT THE ASK RIGHT IN THE TOP 100.
//
//   PATCH /donors/:id/care-plan                    one field of the plan: the ask, the ask-by day or the goal
//   PATCH /donors/:id/care-plan/touches/:taskId    a planned touch's kind or day (the Next step cell)
//
// The Top 100's cells and the plan of care save one field at a time, so a
// change to the Ask never rewrites the goal or the ask-by day beside it (PUT
// /donors/:id/care-plan writes all three). Stage and Owner save through the
// person's own routes (PATCH /donors/:id/stage and /assign), so the pipeline's
// rules run as they do everywhere. Every write is recorded by the one audit
// write; this improves the row it writes with the before and the after.
"use strict";

function register(app, { query, run, wrap, requireAuth, checkWriteAccess, mg, donorOf, ensurePlan, planPayload, shapeMod }) {
  app.patch("/donors/:id/care-plan", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const S = await shapeMod();
    const d = await donorOf(orgId, req.params.id);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    const b = req.body || {};
    const sets = [], vals = [];
    if (b.askCents !== undefined) {
      let c = null;
      if (b.askCents !== null && b.askCents !== "") {
        c = Number(b.askCents);
        if (!Number.isInteger(c) || c < 0) return res.status(400).json({ error: "bad_ask", sentence: "The ask is an amount in dollars." });
      }
      sets.push("ask_cents=?"); vals.push(c);
    }
    if (b.askBy !== undefined) {
      const day = b.askBy ? String(b.askBy) : null;
      if (day && !S.isDay(day)) return res.status(400).json({ error: "bad_date", sentence: "The ask-by date must be a day." });
      sets.push("ask_by=?"); vals.push(day);
    }
    if (b.goal !== undefined) { sets.push("goal=?"); vals.push(b.goal == null ? null : String(b.goal).trim().slice(0, 500) || null); }
    if (!sets.length) return res.status(400).json({ error: "nothing_to_change", sentence: "Say which field to change." });
    const plan = await ensurePlan(orgId, d.id, req);
    const [before] = await query("SELECT goal, ask_cents, ask_by FROM care_plans WHERE id=? AND org_id=?", [plan.id, orgId]);
    await run(`UPDATE care_plans SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...vals, plan.id, orgId]);
    const [after] = await query("SELECT goal, ask_cents, ask_by FROM care_plans WHERE id=? AND org_id=?", [plan.id, orgId]);
    if (req.audit) { req.audit.entity("care_plan", plan.id); req.audit.before(before || null); req.audit.after(after || null); }
    res.json(await planPayload(orgId, d));
  }));

  app.patch("/donors/:id/care-plan/touches/:taskId", requireAuth, mg, checkWriteAccess, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const S = await shapeMod();
    const d = await donorOf(orgId, req.params.id);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    const [t] = await query(
      `SELECT t.id, t.touch_type, t.due, t.done FROM tasks t JOIN care_plans cp ON cp.id = t.care_plan_id AND cp.org_id = t.org_id
        WHERE t.id=? AND t.org_id=? AND t.donor_id=? AND t.voided_at IS NULL`, [req.params.taskId, orgId, d.id]);
    if (!t) return res.status(404).json({ error: "not_found", sentence: "That planned touch is no longer on the plan." });
    const b = req.body || {};
    const sets = [], vals = [];
    if (b.type !== undefined) {
      if (!S.isTouchType(b.type)) return res.status(400).json({ error: "bad_type", sentence: "Pick what kind of touch it is." });
      sets.push("touch_type=?", "kind=?", "title=?"); vals.push(b.type, S.touchKind(b.type), S.touchLabel(b.type));
    }
    if (b.due !== undefined) {
      if (!S.isDay(b.due)) return res.status(400).json({ error: "bad_date", sentence: "A touch needs a day." });
      sets.push("due=?"); vals.push(String(b.due));
    }
    if (!sets.length) return res.status(400).json({ error: "nothing_to_change", sentence: "Say which field to change." });
    await run(`UPDATE tasks SET ${sets.join(", ")}, updated_at=NOW() WHERE id=? AND org_id=?`, [...vals, t.id, orgId]);
    if (req.audit) {
      req.audit.entity("task", t.id);
      req.audit.before({ touch_type: t.touch_type, due: t.due });
      req.audit.after({ touch_type: b.type !== undefined ? b.type : t.touch_type, due: b.due !== undefined ? b.due : t.due });
    }
    res.json(await planPayload(orgId, d));
  }));
}

module.exports = { register };
