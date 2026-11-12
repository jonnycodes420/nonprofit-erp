// server/admin/sales/routesA2.js · SALES-2 Part A. FIND AND WORK PROSPECTS, behind the /ops door.
//
//   GET    /ops/sales/lists                          the prospect lists, with their counts
//   POST   /ops/sales/lists                          { name, config? }
//   PATCH  /ops/sales/lists/:id                      { name?, config? }   DELETE /ops/sales/lists/:id
//   POST   /ops/sales/lists/:id/members              { add?: [orgIds], remove?: [orgIds] }
//   GET    /ops/sales/call/queue?list=&view=&done=   call mode's next person (and the five after)
//   POST   /ops/sales/call/outcome                   { orgId, contactId?, outcome, notes?, phone?, listId?, meeting? }
//   POST   /ops/sales/meetings                       { dealId? | orgId, contactIds?, date, time, place, attendees? }
//   POST   /ops/sales/meetings/:id/after             "How did it go?" { outcome, revisit_on?, lost_reason? }
//   GET    /ops/sales/email/fill?template=&contact=&deal=&org=   a filled template (never sent)
//   POST   /ops/sales/email/drafted                  Copy or Open in Mail: logs "Email drafted"
//   POST   /ops/sales/rec/:type/:id/dnc              { reason } sets Do not contact; { clear: true } lifts it
"use strict";
const LISTS2 = require("./prospectLists");
const CM = require("./callMode");
const MEET = require("./meetings");
const TPL = require("./templates");

const parseJson = (s, dflt) => { try { return s ? JSON.parse(String(s)) : dflt; } catch { return dflt; } };

function mount(app, { query, run, wrap, door, salesLimiter, whoOf, send }) {
  const ctx = { query, run };
  // Each route names its gates on its own line, so the route inventory (tenant-matrix) can read them.

  app.get("/ops/sales/lists", salesLimiter, door, wrap(async (req, res) => res.json({ ok: true, lists: await LISTS2.all(query) })));
  app.post("/ops/sales/lists", salesLimiter, door, wrap(async (req, res) => {
    const b = req.body || {};
    const r = await LISTS2.create(ctx, b.name, b.config, whoOf(req));
    if (r.ok && Array.isArray(b.add)) await LISTS2.members(ctx, r.id, { add: b.add }, whoOf(req));
    send(res, r, 201);
  }));
  app.patch("/ops/sales/lists/:id", salesLimiter, door, wrap(async (req, res) => send(res, await LISTS2.update(ctx, req.params.id, req.body || {}, whoOf(req)))));
  app.delete("/ops/sales/lists/:id", salesLimiter, door, wrap(async (req, res) => send(res, await LISTS2.remove(ctx, req.params.id, whoOf(req)))));
  app.post("/ops/sales/lists/:id/members", salesLimiter, door, wrap(async (req, res) => {
    const b = req.body || {};
    send(res, await LISTS2.members(ctx, req.params.id, { add: Array.isArray(b.add) ? b.add : [], remove: Array.isArray(b.remove) ? b.remove : [] }, whoOf(req)));
  }));

  app.get("/ops/sales/call/queue", salesLimiter, door, wrap(async (req, res) => {
    const done = String(req.query.done || "").split(",").map(s => s.trim()).filter(Boolean).slice(0, 2000);
    send(res, await CM.loadQueue(query, { view: parseJson(req.query.view, {}), listId: req.query.list ? String(req.query.list) : null, done, now: Date.now() }));
  }));
  app.post("/ops/sales/call/outcome", salesLimiter, door, wrap(async (req, res) => {
    const r = await CM.logOutcome(ctx, req.body || {}, whoOf(req), Date.now());
    if (r.ok && req.audit) req.audit.label(`sales call: ${(req.body || {}).outcome}`);
    send(res, r, 201);
  }));

  app.post("/ops/sales/meetings", salesLimiter, door, wrap(async (req, res) => send(res, await MEET.book(ctx, req.body || {}, whoOf(req), Date.now()), 201)));
  app.post("/ops/sales/meetings/:id/after", salesLimiter, door, wrap(async (req, res) => send(res, await MEET.after(ctx, req.params.id, req.body || {}, whoOf(req)))));

  app.get("/ops/sales/email/fill", salesLimiter, door, wrap(async (req, res) => {
    const tpls = await TPL.all(query);
    const tpl = tpls.find(t => t.id === String(req.query.template || "")) || tpls[0];
    if (!tpl) return res.status(404).json({ error: "not_found", message: "There are no templates yet. Add one in Sales settings." });
    const v = await TPL.valuesFor(query, { contactId: req.query.contact, dealId: req.query.deal, orgId: req.query.org }, whoOf(req).name);
    if (v.error) return send(res, v);
    const f = TPL.fill(tpl, v.values);
    const to = v.contact ? (v.contact.emails || [])[0] || "" : "";
    const dnc = !!((v.contact && v.contact.dnc_at) || (v.org && v.org.dnc_at));
    res.json({ ok: true, template: { id: tpl.id, name: tpl.name }, templates: tpls.map(t => ({ id: t.id, name: t.name })), to, ...f,
      mailto: dnc ? null : TPL.mailto(to, f.subject, f.body), dnc, contactId: v.contact ? v.contact.id : null, orgId: v.org ? v.org.id : null,
      says: "Steward never sends this. Copy it or open it in your own mail, and send it yourself." });
  }));
  app.post("/ops/sales/email/drafted", salesLimiter, door, wrap(async (req, res) => send(res, await TPL.logDrafted(ctx, req.body || {}, whoOf(req)), 201)));

  app.post("/ops/sales/rec/:type/:id/dnc", salesLimiter, door, wrap(async (req, res) => {
    const { type, id } = req.params;
    if (type !== "org" && type !== "contact") return res.status(404).json({ error: "not_found" });
    const b = req.body || {}, who = whoOf(req);
    const table = type === "org" ? "sales_orgs" : "sales_contacts";
    const reason = String(b.reason || "").trim().slice(0, 500);
    if (!b.clear && !reason) return res.status(400).json({ error: "invalid", message: "Say why: a reason is kept with the flag." });
    const r = b.clear
      ? await run(`UPDATE ${table} SET dnc_at = NULL, dnc_reason = NULL, dnc_by_name = NULL, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [who.id, who.name, id])
      : await run(`UPDATE ${table} SET dnc_at = ?, dnc_reason = ?, dnc_by_name = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`,
        [new Date().toISOString(), reason, who.name, who.id, who.name, id]);
    if (r.changes && req.audit) req.audit.label(`sales ${type}: Do not contact ${b.clear ? "lifted" : "set"}`);
    send(res, r.changes ? { ok: true } : { error: "not_found" });
  }));
}

module.exports = { mount };
