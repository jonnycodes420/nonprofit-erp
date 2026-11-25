// server/admin/backgroundWork.js · BGWORK-1. "RUN BACKGROUND WORK FOR THIS TEST ORG".
//
// SCALE-5 stopped every per-org sweep (the mailbox read among them) for orgs
// nobody uses: internal test orgs and fixtures. One of Jonathan's test orgs may
// need its mail read on purpose. This switch, on the org in the admin console,
// keeps that org in liveOrgIds whatever its kind (orgKind.isLiveOrg), so every
// sweep, the mail read and its stale alarm treat it as live. Off: its kind decides.
// The audit trail records the change (middleware/auditTrail.js); this route only
// names it.
"use strict";
const LIVE = require("../orgs/liveOrgs");

// `door` is /ops's (server/admin/opsRoutes.js opsOnly): a super admin's session, 404 to anyone else.
function mount(app, { query, run, wrap, door }) {
  app.post("/admin/orgs/:id/background-work", door, wrap(async (req, res) => {
    const on = req.body && req.body.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: "on_required", message: "Say on or off." });
    const [org] = await query("SELECT id, name, run_background_work FROM orgs WHERE id=?", [req.params.id]);
    if (!org) return res.status(404).json({ error: "Org not found" });
    await run("UPDATE orgs SET run_background_work=? WHERE id=?", [on, org.id]);
    LIVE.forget();   // this process's list; the worker's expires within its minute
    if (req.audit) {
      req.audit.action(on ? "run background work" : "stop background work");
      req.audit.forOrg(org.id);
      req.audit.entity("org setting", org.id, `Background work for ${org.name}`);
      req.audit.before({ runBackgroundWork: org.run_background_work === true });
      req.audit.after({ runBackgroundWork: on });
    }
    const live = (await LIVE.liveOrgIds(query, { fresh: true })).includes(org.id);
    res.json({ ok: true, on, live,
      sentence: on ? `Background work runs for ${org.name}: its mailbox is read and checked, like a customer's.`
        : live ? `${org.name} is live by its kind, so its background work still runs.`
        : `Background work is off for ${org.name}, as for every test org.` });
  }));
}

module.exports = { mount };
