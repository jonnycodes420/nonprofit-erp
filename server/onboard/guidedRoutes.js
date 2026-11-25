// server/onboard/guidedRoutes.js · ONBOARD-4 items 4 and 5, her side.
//
//   GET  /onboarding/guided                    the five steps (guided.js); show:false
//                                              for an org not in onboarding
//   POST /onboarding/guided/skip               { step, skip: true|false }: skip for now, or bring it back
//   POST /onboarding/concierge                 "Send it to us": { fileName, fileType, data (base64), note }
//   POST /onboarding/concierge/booking/:id     the file she attached when she booked: send that one
//   GET  /onboarding/booking-file/:id          download that file again (to import it herself)
//
// Nothing here loads a person or a gift: Load is pressed on /ops (opsConciergeRoutes.js).
"use strict";
const GUIDED = require("./guided");
const CONCIERGE = require("./concierge");
const { inOnboarding } = require("./setupRoutes");

function mount(app, ctx) {
  const { query, run, wrap, requireAuth, checkWriteAccess, actor } = ctx;
  const who = req => (actor ? actor(req) : { id: req.user.userId, name: String(req.user.name || req.user.email || "user").slice(0, 120) });
  const may = checkWriteAccess || ((req, res, next) => next());

  app.get("/onboarding/guided", requireAuth, wrap(async (req, res) => {
    if (!(await inOnboarding(query, req.user.orgId))) return res.json({ show: false });
    const out = await GUIDED.read(query, req.user.orgId);
    res.json(out || { show: false });
  }));

  app.post("/onboarding/guided/skip", requireAuth, may, wrap(async (req, res) => {
    const b = req.body || {};
    const r = await GUIDED.setSkip(run, req.user.orgId, String(b.step || ""), b.skip !== false, who(req));
    if (r.error) return res.status(400).json(r);
    res.json({ ok: true, ...(await GUIDED.read(query, req.user.orgId)) });
  }));

  app.post("/onboarding/concierge", requireAuth, may, wrap(async (req, res) => {
    const file = CONCIERGE.readUpload(req.body || {});
    if (file.error) return res.status(400).json(file);
    const id = await CONCIERGE.create({ query, run }, req.user.orgId, file, who(req), { note: (req.body || {}).note });
    if (req.audit) { req.audit.entity("concierge_import", id, file.fileName); req.audit.label(`Sent a donor file to Steward to load: ${file.fileName}`); }
    res.status(201).json({ ok: true, id, sentence: "Received. Jonathan maps it and loads it; nothing goes in until a person presses Load, and you'll check the totals before you rely on them." });
  }));

  app.post("/onboarding/concierge/booking/:id", requireAuth, may, wrap(async (req, res) => {
    const b = await CONCIERGE.bookingFile(query, req.user.orgId, String(req.params.id));
    if (!b) return res.status(404).json({ error: "not_found", message: "That file is not waiting for this organization." });
    const file = { fileName: b.file_name, fileType: b.file_type, bytes: b.file_data };
    const id = await CONCIERGE.create({ query, run }, req.user.orgId, file, who(req), { source: "booking", bookingId: b.id });
    res.status(201).json({ ok: true, id });
  }));

  app.get("/onboarding/booking-file/:id", requireAuth, wrap(async (req, res) => {
    const b = await CONCIERGE.bookingFile(query, req.user.orgId, String(req.params.id));
    if (!b) return res.status(404).json({ error: "not_found" });
    res.set("Content-Type", b.file_type || "application/octet-stream");
    res.set("Content-Disposition", `attachment; filename="${String(b.file_name).replace(/"/g, "")}"`);
    res.send(b.file_data);
  }));
}

module.exports = { mount };
