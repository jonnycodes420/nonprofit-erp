// server/donors/touchTypes.js · TOUCH-1. LOG ANY TOUCH IN HER OWN WORDS.
//
//   GET    /touch-types                  the kinds she can pick (shared/touchKinds.js) and her org's own
//   POST   /touch-types                  an admin adds one ({ label })
//   DELETE /touch-types/:id              an admin takes one away (archived: touches logged as it keep their words)
//   GET    /donors/:id/planned-touches   the plan-of-care touches still open for this person, and which kinds complete each
//
// And the parts POST /donors/:id/conversations reads for a touch logged with
// one of these kinds (resolveTouch, plannedFor, completePlanned).
//
// Registered from interactions.js's mount, like tasks/threadDone.js. Nothing
// here sends anything; every write is recorded by the one audit write.
"use strict";
const { newId } = require("../shared/newId");

let _kinds = null;
const kindsMod = async () => _kinds || (_kinds = await import("../../shared/touchKinds.js"));
let _care = null;
const careMod = async () => _care || (_care = await import("../../shared/careShape.js"));

function make({ query, run }) {
  async function customOf(orgId) {
    return query("SELECT id, label FROM org_touch_types WHERE org_id=? AND archived_at IS NULL ORDER BY lower(label)", [orgId]);
  }
  // The kind a request names, or null: a built-in, or one of this org's own.
  async function resolveTouch(orgId, key) {
    const K = await kindsMod();
    const k = String(key || "");
    if (K.isTouchKind(k)) return K.touchKindFor(k);
    if (!K.isCustomKey(k)) return null;
    const [c] = await query("SELECT id, label FROM org_touch_types WHERE id=? AND org_id=?", [k.slice(K.CUSTOM_PREFIX.length), orgId]);
    return c ? K.touchKindFor(k, [c]) : null;
  }
  // The open plan-of-care touches for this person, soonest first, each with the
  // kinds of touch that complete it ("Handwritten note" ← letter).
  async function plannedFor(orgId, donorId) {
    const K = await kindsMod(), C = await careMod();
    const rows = await query(
      `SELECT t.id, t.touch_type, t.due FROM tasks t JOIN care_plans cp ON cp.id = t.care_plan_id AND cp.org_id = t.org_id
        WHERE t.org_id=? AND t.donor_id=? AND t.done=0 AND t.voided_at IS NULL AND t.touch_type IS NOT NULL
        ORDER BY t.due ASC NULLS LAST, t.id`, [orgId, donorId]);
    return rows.map(r => ({ taskId: r.id, type: r.touch_type, label: C.touchLabel(r.touch_type), due: String(r.due || "").slice(0, 10) || null,
      kinds: K.TOUCH_KINDS.filter(k => k.care.includes(r.touch_type)).map(k => k.key) }));
  }
  // Mark a planned touch done by the touch she logged. Done early is fine: the
  // task keeps its due day, and completed_at is when she logged it.
  async function completePlanned(orgId, donorId, taskId, kindKey, who) {
    const open = await plannedFor(orgId, donorId);
    const t = open.find(x => x.taskId === String(taskId || ""));
    if (!t || !t.kinds.includes(kindKey)) return null;
    await run(`UPDATE tasks SET done=1, completed_at=COALESCE(completed_at, NOW()), completed_by_name=?, updated_at=NOW()
                WHERE id=? AND org_id=? AND donor_id=? AND done=0`, [who.name || null, t.taskId, orgId, donorId]);
    return t;
  }
  // A touch from "Log a touch" (the request names `touchKind`): what the
  // conversations route writes for it, or { refused }. A request with only the
  // older `touch` key never comes here, so every older caller is unchanged.
  async function prepare(orgId, donorId, body, today, me) {
    const K = await kindsMod();
    const kind = await resolveTouch(orgId, body.touchKind);
    if (!kind) return { refused: { status: 400, body: { error: "Unknown touch type", sentence: "Pick what you did." } } };
    const words = typeof body.line === "string" ? body.line.trim().slice(0, 8000) : "";
    if (K.wordsRequired(kind.key) && !words)
      return { refused: { status: 400, body: { error: "words_required", sentence: "Say what you did, in your words." } } };
    const date = String(body.date || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > today)
      return { refused: { status: 400, body: { error: "future_touch", sentence: "A touch is something already done: pick today or an earlier day." } } };
    const callResult = kind.key === "call" && K.isCallResult(body.callResult) ? body.callResult : null;
    let by = null;
    if (body.byUserId && String(body.byUserId) !== String(me.id)) {
      const [u] = await query(
        `SELECT u.id, u.name FROM users u WHERE u.id=? AND u.deactivated_at IS NULL
            AND (u.org_id=? OR EXISTS (SELECT 1 FROM org_memberships m WHERE m.user_id=u.id AND m.org_id=? AND m.revoked_at IS NULL))`, [String(body.byUserId), orgId, orgId]).catch(() => []);
      if (!u) return { refused: { status: 400, body: { error: "bad_user", sentence: "That person is not on your team." } } };
      by = u;
    }
    let completes = null;
    if (body.completesTaskId) {
      completes = (await plannedFor(orgId, donorId)).find(t => t.taskId === String(body.completesTaskId) && t.kinds.includes(kind.key)) || null;
      if (!completes) return { refused: { status: 409, body: { error: "plan_changed", sentence: "That planned touch is already done, or is a different kind. Nothing was logged." } } };
    }
    return {
      kind, completes, line: K.noteFor(kind.label, words),
      touch: { key: K.legacyKeyFor(kind.key, callResult) || kind.key, interactionType: kind.interactionType },
      meta: { touch_kind: kind.key, touch_label: kind.label, ...(callResult ? { call_result: callResult } : {}),
              ...(by ? { by_id: by.id, by_name: by.name } : {}), ...(completes ? { completes_task: completes.taskId } : {}) },
    };
  }
  return { customOf, resolveTouch, plannedFor, completePlanned, prepare };
}

function register(app, ctx) {
  const { query, run, wrap, requireAuth, requireAdmin, checkWriteAccess, actor } = ctx;
  const T = make(ctx);

  app.get("/touch-types", requireAuth, wrap(async (req, res) => {
    const K = await kindsMod();
    res.json({ kinds: K.TOUCH_KINDS.map(k => ({ key: k.key, label: k.label })),
      custom: (await T.customOf(req.user.orgId)).map(c => ({ key: K.CUSTOM_PREFIX + c.id, id: c.id, label: c.label })),
      callResults: K.CALL_RESULTS });
  }));

  app.post("/touch-types", requireAuth, requireAdmin, checkWriteAccess, wrap(async (req, res) => {
    const K = await kindsMod();
    const orgId = req.user.orgId;
    const label = K.cleanLabel(req.body && req.body.label);
    if (!label) return res.status(400).json({ error: "label_required", sentence: "Name the kind of touch, for example Birthday card." });
    if (K.TOUCH_KINDS.some(k => k.label.toLowerCase() === label.toLowerCase()))
      return res.status(409).json({ error: "built_in", sentence: `${label} is already one of the kinds.` });
    const [had] = await query("SELECT id FROM org_touch_types WHERE org_id=? AND lower(label)=lower(?) AND archived_at IS NULL", [orgId, label]);
    if (had) return res.status(409).json({ error: "exists", sentence: `${label} is already one of your kinds.` });
    const a = actor(req), id = newId("ttp");
    await run("INSERT INTO org_touch_types (id, org_id, label, created_by, created_by_name) VALUES (?,?,?,?,?)", [id, orgId, label, a.id, a.name]);
    res.status(201).json({ key: K.CUSTOM_PREFIX + id, id, label });
  }));

  app.delete("/touch-types/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
    const [t] = await query("SELECT id, label FROM org_touch_types WHERE id=? AND org_id=? AND archived_at IS NULL", [req.params.id, req.user.orgId]);
    if (!t) return res.status(404).json({ error: "not_found", sentence: "That kind is no longer here." });
    await run("UPDATE org_touch_types SET archived_at=NOW() WHERE id=? AND org_id=?", [t.id, req.user.orgId]);
    res.json({ ok: true, sentence: `${t.label} is off the list. Touches already logged as ${t.label} keep it.` });
  }));

  app.get("/donors/:id/planned-touches", requireAuth, wrap(async (req, res) => {
    const [d] = await query("SELECT id FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, req.user.orgId]);
    if (!d) return res.status(404).json({ error: "Donor not found" });
    res.json({ planned: await T.plannedFor(req.user.orgId, d.id) });
  }));
  return T;
}

module.exports = { register, make };
