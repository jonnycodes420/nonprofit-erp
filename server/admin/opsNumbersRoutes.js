// NUMBERS-6 item 6 · /ops's Numbers card (super-admins only).
//
//   GET  /ops/numbers            the nightly check per org, real orgs first (opsNumbers.js)
//   POST /ops/numbers/test-org   { orgId, isTest }  marks an org as a test, or not
//   POST /ops/numbers/check-org  { orgId }  SCALE-4: checks one org now, on the worker (a
//                                test org is not checked at night)
//
// Behind the same door as GET /ops: 404 to anyone who is not a live super-admin.
// Marking an org is one flag (orgs.is_test_org); it changes no other data, and
// the audit middleware writes the row that says who marked it.
"use strict";
const NUMS = require("./opsNumbers");

function mount(app, { query, run, wrap, opsOnly, opsLimiter }) {
  app.get("/ops/numbers", opsLimiter, opsOnly, wrap(async (req, res) => {
    res.json(await NUMS.card(query));
  }));

  app.post("/ops/numbers/test-org", opsLimiter, opsOnly, wrap(async (req, res) => {
    const b = req.body || {};
    const orgId = String(b.orgId || "");
    if (typeof b.isTest !== "boolean") return res.status(400).json({ error: "bad_flag", message: "Say whether this org is a test (isTest true or false)." });
    const [o] = await query(`SELECT id, name, COALESCE(is_test_org, false) AS is_test FROM orgs WHERE id = ?`, [orgId]);
    if (!o) return res.status(404).json({ error: "not_found", message: "No such org." });
    await run(`UPDATE orgs SET is_test_org = ? WHERE id = ?`, [b.isTest, orgId]);
    if (req.audit) {
      req.audit.entity("org", orgId, o.name);
      req.audit.label(`${b.isTest ? "Marked" : "Unmarked"} ${o.name} as a test org on /ops (no data changed)`);
    }
    res.json({ ok: true, orgId, isTest: b.isTest,
      sentence: `${o.name} is ${b.isTest ? "now listed as a test org, below the real ones" : "listed as a real org again"}. No data changed.` });
  }));

  // SCALE-4: the nightly check skips test orgs; this checks one on demand. It is
  // queued, so it runs on the worker on one connection, never in this request.
  app.post("/ops/numbers/check-org", opsLimiter, opsOnly, wrap(async (req, res) => {
    const orgId = String((req.body || {}).orgId || "");
    const [o] = await query(`SELECT id, name FROM orgs WHERE id = ?`, [orgId]);
    if (!o) return res.status(404).json({ error: "not_found", message: "No such org." });
    await require("../../jobQueue").enqueue({ name: "numberCheckOrg", key: `numberCheckOrg:${orgId}`, payload: { orgId } });
    if (req.audit) { req.audit.entity("org", orgId, o.name); req.audit.label(`Asked for the number check of ${o.name} on /ops (counts only)`); }
    res.json({ ok: true, orgId, sentence: `Checking ${o.name} now, on the worker. Its count shows here when it finishes; a 25,000-person org takes a few minutes.` });
  }));
}

module.exports = { mount };
