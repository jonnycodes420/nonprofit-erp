// server/onboard/opsConciergeRoutes.js · ONBOARD-4 items 5 and 6, /ops's side (super-admins only).
//
//   GET  /ops/onboarding/stuck                  the Stuck column (stuck.js): each row with its drafted note
//   GET  /ops/onboarding/concierge              every "Send it to us" job, newest first
//   GET  /ops/onboarding/concierge/:id/file     the file as she sent it (to read in the browser)
//   POST /ops/onboarding/concierge/:id/map      { sheets }: the mapper's first pass on the cells the
//                                               importer's reader took from a workbook
//   POST /ops/onboarding/concierge/:id/load     LOAD. The one writer of her people: the normal
//                                               spreadsheet import, with its Undo in her Imports
//
// Mounted by opsBoardRoutes.js above its /ops/onboarding/:orgId, behind the same door (opsOnly).
"use strict";
const STUCK = require("./stuck");
const CONCIERGE = require("./concierge");

function mount(app, { query, run, wrap, opsOnly, opsLimiter }) {
  const who = req => ({ id: req.user.userId, name: String(req.user.name || req.user.email || "super-admin").slice(0, 120) });

  app.get("/ops/onboarding/stuck", opsLimiter, opsOnly, wrap(async (req, res) => {
    const rows = await STUCK.list(query);
    res.json({ ok: true, rows, titles: STUCK.TITLES, sentence: STUCK.SENTENCE });
  }));

  app.get("/ops/onboarding/concierge", opsLimiter, opsOnly, wrap(async (req, res) => {
    res.json({ ok: true, jobs: await CONCIERGE.list(query),
      sentence: "Files sent with \"Send it to us\". The mapper reads each one first; nothing is loaded until you press Load, which runs the normal import (its Undo is in the org's Imports)." });
  }));

  app.get("/ops/onboarding/concierge/:id/file", opsLimiter, opsOnly, wrap(async (req, res) => {
    const [j] = await query(`SELECT file_name, file_type, file_data FROM onboard_concierge_jobs WHERE id = ?`, [String(req.params.id)]);
    if (!j) return res.status(404).json({ error: "not_found" });
    res.set("Content-Type", j.file_type || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${String(j.file_name).replace(/"/g, "")}"`);
    res.send(j.file_data);
  }));

  app.post("/ops/onboarding/concierge/:id/map", opsLimiter, opsOnly, wrap(async (req, res) => {
    const r = await CONCIERGE.firstPass({ query, run }, String(req.params.id), (req.body || {}).sheets, who(req));
    if (r.error) return res.status(r.error === "not_found" ? 404 : 409).json(r);
    res.json(r);
  }));

  app.post("/ops/onboarding/concierge/:id/load", opsLimiter, opsOnly, wrap(async (req, res) => {
    const id = String(req.params.id);
    const r = await CONCIERGE.load({ query, run }, id, who(req), { userId: req.user.userId, name: req.user.name, email: req.user.email, role: "admin", support: true });
    if (req.audit) { req.audit.entity("concierge_import", id, null); req.audit.label(`/ops concierge Load ${id}${r.importId ? ` → ${r.importId}` : ""}`); }
    if (r.error) return res.status(r.error === "not_found" ? 404 : 409).json(r);
    res.json(r);
  }));
}

module.exports = { mount };
