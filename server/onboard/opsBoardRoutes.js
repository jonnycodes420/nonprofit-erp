// server/onboard/opsBoardRoutes.js · ONBOARD-2. /ops → Onboarding (super-admins only).
//
//   GET  /ops/onboarding          one row per customer org: the stage on a
//                                 5-dot track, days in it, the next action, the
//                                 first charge date and MRR; the line at the top
//   GET  /ops/onboarding/:orgId   that org's checklist: every gate and its evidence
//   POST /ops/onboarding/:orgId   the two hand-entered facts ONLY: { waitingOn,
//                                 verbalYesOn }. A stage in the body is ignored,
//                                 and so is anything else: a stage moves on
//                                 signals alone (the planted defect is this line)
//
// Behind GET /ops's door (opsOnly: 404 to anyone who is not a live super-admin).
"use strict";
const BOARD = require("./board");

const PLANT = process.env.TEST_MODE === "1" ? process.env.ONBOARD2_PLANT || "" : "";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function mount(app, { query, run, wrap, opsOnly, opsLimiter }) {
  app.get("/ops/onboarding", opsLimiter, opsOnly, wrap(async (req, res) => {
    try { res.json({ ok: true, ...(await BOARD.board(query)) }); }
    catch (e) { console.warn(`[ops] onboarding could not be read: ${e.message}`); res.json({ ok: false, error: "The onboarding board could not be read. Try again in a minute." }); }
  }));

  app.get("/ops/onboarding/:orgId", opsLimiter, opsOnly, wrap(async (req, res) => {
    const row = await BOARD.one(query, String(req.params.orgId));
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, row });
  }));

  app.post("/ops/onboarding/:orgId", opsLimiter, opsOnly, wrap(async (req, res) => {
    const orgId = String(req.params.orgId);
    const [org] = await query(`SELECT id, name FROM orgs WHERE id = ?`, [orgId]);
    if (!org) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    const who = { id: req.user.userId, name: String(req.user.name || req.user.email || "super-admin").slice(0, 120) };
    const sets = [], vals = [];
    if ("waitingOn" in b) { sets.push("waiting_on = ?"); vals.push(String(b.waitingOn || "").replace(/\s+/g, " ").trim().slice(0, 200) || null); }
    if ("verbalYesOn" in b) {
      const d = b.verbalYesOn ? String(b.verbalYesOn) : null;
      if (d && !DAY_RE.test(d)) return res.status(400).json({ error: "bad_date", message: "The verbal-yes date is a day, like 2026-11-03." });
      sets.push("verbal_yes_on = ?"); vals.push(d);
    }
    if (PLANT === "manual" && b.stage) { sets.push("stage = ?"); vals.push(String(b.stage)); }   // THE PLANTED DEFECT (tests only)
    if (!sets.length) return res.status(400).json({ error: "nothing_to_change", message: "Only Waiting on and the verbal-yes date are entered by hand." });
    await BOARD.ensureRow(run, orgId, who);
    await run(`UPDATE org_onboarding SET ${sets.join(", ")}, updated_by = ?, updated_by_name = ? WHERE org_id = ?`, [...vals, who.id, who.name, orgId]);
    if (req.audit) { req.audit.entity("onboarding", orgId, org.name); req.audit.label(`/ops onboarding: ${Object.keys(b).filter(k => k === "waitingOn" || k === "verbalYesOn").join(", ")} for ${org.name}`); }
    if (PLANT !== "manual") await BOARD.recompute({ query, run }, [orgId]);
    res.json({ ok: true, row: await BOARD.one(query, orgId) });
  }));
}

module.exports = { mount };
