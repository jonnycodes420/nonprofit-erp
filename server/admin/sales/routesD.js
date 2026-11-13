// server/admin/sales/routesD.js · SALES-3 Part B. THE CUSTOMERS BOARD, NURTURE AND PROOF.
//
// Behind the /ops door (super-admins only):
//   GET  /ops/sales/customers                          the board: one row per linked Steward org
//   GET  /ops/sales/customers/:id/fact/:key            what one fact counted (dated counts, never a donor)
//   POST /ops/sales/customers/:id/nurture              start the pilot rhythm (tasks only)
//   POST /ops/sales/customers/:id/checkin              { lines: [{ text, bug }] } → the timeline, and bugs to /ops's board
//   PUT  /ops/sales/customers/:id/proof                { testimonial_state, testimonial_text, references_asked }
//   GET  /ops/sales/health   PUT /ops/sales/health     the health rule
"use strict";
const C = require("./customers");

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };
  const { withAmbientTransaction } = require("../../db/query");
  // Each route names its gates on its own line, so the route inventory (tenant-matrix) can read them.

  app.get("/ops/sales/customers", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, ...(await C.board(query)), prompt: C.CHECKIN_PROMPT })));
  app.get("/ops/sales/customers/:id/fact/:key", salesLimiter, door, wrap(async (req, res) => {
    const r = await C.factRows(query, req.params.id, req.params.key);
    if (!r) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, ...r });
  }));
  app.post("/ops/sales/customers/:id/nurture", salesLimiter, door, wrap(async (req, res) => send(res, await withAmbientTransaction(() => C.startNurture(ctx, req.params.id, whoOf(req))), 201)));
  app.post("/ops/sales/customers/:id/checkin", salesLimiter, door, wrap(async (req, res) => {
    const r = await withAmbientTransaction(() => C.logCheckin(ctx, req.params.id, req.body || {}, whoOf(req)));
    if (r.ok && req.audit) req.audit.label(`sales check-in logged${r.filed.length ? `, ${r.filed.length} bug(s) to the /ops board` : ""}`);
    send(res, r, 201);
  }));
  app.put("/ops/sales/customers/:id/proof", salesLimiter, door, wrap(async (req, res) => send(res, await C.saveProof(ctx, req.params.id, req.body || {}, whoOf(req)))));
  app.get("/ops/sales/health", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, ...(await C.healthRule(query)), facts: C.FACTS, defaults: C.DEFAULT_HEALTH })));
  app.put("/ops/sales/health", salesLimiter, door, wrap(async (req, res) => {
    const who = whoOf(req), v = C.cleanHealth({ rules: Array.isArray((req.body || {}).rules) ? req.body.rules : [] });
    await run(`INSERT INTO sales_settings (key, value, created_by, created_by_name, updated_by, updated_by_name) VALUES ('health', ?::jsonb, ?, ?, ?, ?)
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`,
      [JSON.stringify(v), who.id, who.name, who.id, who.name]);
    res.json({ ok: true, ...v });
  }));
}

module.exports = { mount };
