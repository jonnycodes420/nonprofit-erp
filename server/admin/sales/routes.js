// server/admin/sales/routes.js · SALES-1. /ops → Sales: STEWARD'S OWN SALES CRM.
//
// Every route here sits behind GET /ops's door (opsOnly): 404 to anyone who is
// not a live super-admin, read from the users row on every request. No customer
// ever reaches these, and no org route reads a sales_ table.
//
//   GET    /ops/sales/meta                    owners, custom properties, pipelines, saved views, settings
//   GET    /ops/sales/home                    Today and the forecast card
//   GET    /ops/sales/search?q=               one box across organizations, contacts and deals
//   GET    /ops/sales/list/:type?view=        a list: { filters, sort, q } as JSON in `view`
//   GET    /ops/sales/export/:type?view=&columns=   that list as CSV
//   POST   /ops/sales/rec/:type               create (409 duplicate unless force)
//   GET    /ops/sales/rec/:type/:id           the record page: properties, timeline, linked records
//   PATCH  /ops/sales/rec/:type/:id           edit inline
//   DELETE /ops/sales/rec/:type/:id           delete that record only
//   POST   /ops/sales/bulk/:type              { ids, action: set|owner|stage|delete, field?, value? }
//   POST   /ops/sales/link | /ops/sales/unlink | PATCH /ops/sales/link
//   POST   /ops/sales/deals/:id/stage         { stage_id, lost_reason? } (the board's drag)
//   POST   /ops/sales/merge/:type             { keep, merge }
//   POST|PATCH|DELETE /ops/sales/activities[/:id]   GET /ops/sales/tasks?state=
//   POST   /ops/sales/import/preview | /ops/sales/import/commit | /ops/sales/import/:id/undo   GET /ops/sales/imports
//   POST|PATCH|DELETE /ops/sales/properties[/:id]
//   POST   /ops/sales/pipelines   PATCH /ops/sales/pipelines/:id   PUT /ops/sales/pipelines/:id/stages
//   POST|DELETE /ops/sales/views[/:id]   PUT /ops/sales/settings
//   POST   /ops/sales/orgs/:id/steward        { stewardOrgId | null }   GET /ops/sales/steward-orgs?q=
"use strict";
const { newId } = require("../../shared/newId");
const { rateLimit } = require("../../../rateLimitStore");
const M = require("./model");
const REC = require("./records");
const LINKS = require("./links");
const ACT = require("./activities");
const LISTS = require("./lists");
const PIPES = require("./pipelines");
const MERGE = require("./merge");
const IMP = require("./importCsv");
const LINK = require("./stewardLink");
const TODAY = require("./today");
const FORECAST = require("./forecast");

// A working CRM makes many small calls; per IP, behind nothing but the door.
const salesLimiter = rateLimit("salesLimiter", {
  windowMs: 15 * 60 * 1000, limit: 3000, standardHeaders: true, legacyHeaders: false,
  skip: () => process.env.TEST_MODE === "1" || process.env.DISABLE_RATE_LIMIT === "1",
});
const TZ = "America/New_York";
const SETTING_KEYS = ["goal"];

const parseJson = (s, dflt) => { try { return s ? JSON.parse(String(s)) : dflt; } catch { return dflt; } };
const whoOf = req => ({ id: req.user.userId, name: String(req.user.name || req.user.email || "super-admin").slice(0, 120) });
const isType = t => M.OBJECT_IDS.includes(t);
function send(res, r, okStatus = 200) {
  if (!r || r.ok) return res.status(okStatus).json(r || { ok: true });
  const code = r.error === "not_found" ? 404 : r.error === "duplicate" ? 409 : 400;
  return res.status(code).json(r);
}

async function settings(query) {
  const rows = await query(`SELECT key, value FROM sales_settings WHERE key = ANY(?)`, [SETTING_KEYS]);
  const m = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { goal: m.goal || M.DEFAULT_GOAL, tz: TZ };
}

function mount(app, { query, run, wrap, opsOnly }) {
  const ctx = { query, run };
  // THE PLANTED DEFECT (SALES1_PLANT=door, tests only): any signed-in person passes. §0 goes red.
  const door = REC.PLANT === "door" ? (req, res, next) => require("../../../auth").requireAuth404(req, res, next) : opsOnly;
  const R = (method, path, fn) => app[method](path, salesLimiter, door, wrap(fn));

  R("get", "/ops/sales/meta", async (req, res) => {
    const [owners, properties, pipelines, views, s] = await Promise.all([
      REC.owners(query), REC.properties(query), PIPES.readAll(query),
      query(`SELECT id, object, name, config FROM sales_views ORDER BY object, name`), settings(query)]);
    res.json({ ok: true, owners, properties, pipelines, views, settings: s, objects: M.OBJECTS, assocFields: LISTS.ASSOC_FIELDS, ops: LISTS.OPS,
      propTypes: M.PROP_TYPES, roles: M.ROLES, activityKinds: M.ACTIVITY_KINDS, me: req.user.userId });
  });

  R("get", "/ops/sales/home", async (req, res) => {
    const now = Date.now();
    const [deals, pipelines, s, history] = await Promise.all([LISTS.rowsFor(query, "deal"), PIPES.readAll(query), settings(query),
      query(`SELECT deal_id, to_stage_id, to_name, at FROM sales_stage_history WHERE at > ?`, [new Date(now - 400 * 86400000).toISOString()])]);
    const stages = PIPES.stageIndex(pipelines);
    const today = TODAY.buildToday(await TODAY.loadToday(query, deals, stages, now), now, s.tz);
    // MRR now is ONBOARD-2's own figure, computed once, there.
    let mrrNowCents = 0, mrrError = null;
    try { mrrNowCents = (await require("../../onboard/board").board(query, now)).summary.mrrNowCents; }
    catch (e) { mrrError = "MRR now could not be read from the onboarding board."; }
    const fc = FORECAST.forecast({ deals, history, stages, mrrNowCents, goal: s.goal }, now, s.tz);
    res.json({ ok: true, today, forecast: { ...fc, mrrError } });
  });

  R("get", "/ops/sales/search", async (req, res) => res.json({ ok: true, results: await LISTS.search(query, req.query.q) }));

  R("get", "/ops/sales/list/:type", async (req, res) => {
    const type = req.params.type;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const view = parseJson(req.query.view, {});
    const rows = LISTS.applyView(await LISTS.rowsFor(query, type), view);
    res.json({ ok: true, total: rows.length, rows });
  });

  R("get", "/ops/sales/export/:type", async (req, res) => {
    const type = req.params.type;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const view = parseJson(req.query.view, {});
    const columns = parseJson(req.query.columns, null);
    const [all, props, owners, pipelines] = await Promise.all([LISTS.rowsFor(query, type), REC.properties(query, type), REC.owners(query), PIPES.readAll(query)]);
    const csv = IMP.toCsv(type, LISTS.applyView(all, view), Array.isArray(columns) ? columns : null, { props, owners, stages: PIPES.stageIndex(pipelines) });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="steward-sales-${M.OBJECTS[type].plural.toLowerCase()}.csv"`);
    res.send(csv);
  });

  R("post", "/ops/sales/rec/:type", async (req, res) => {
    const type = req.params.type;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    const r = await REC.create(ctx, type, b, whoOf(req), { force: b.force === true });
    if (r.ok && Array.isArray(b.links)) for (const l of b.links) if (l && isType(l.type)) await LINKS.associate(ctx, type, r.id, l.type, String(l.id), { label: l.label, primary: l.primary }, whoOf(req));
    if (r.ok && req.audit) req.audit.entity(`sales ${type}`, r.id, M.nameOf(type, { name: b.name, first_name: b.first_name, last_name: b.last_name }));
    send(res, r, 201);
  });

  R("get", "/ops/sales/rec/:type/:id", async (req, res) => {
    const { type, id } = req.params;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const row = await REC.readRow(query, type, id);
    if (!row) return res.status(404).json({ error: "not_found" });
    const [linked, timeline, merges] = await Promise.all([LINKS.linkedOf(query, type, id), ACT.forRecord(query, type, id),
      type === "deal" ? [] : MERGE.mergesOf(query, type, id)]);
    const out = { ok: true, type, record: { ...row, displayName: M.nameOf(type, row), value_cents: row.value_cents != null ? Number(row.value_cents) : undefined }, linked, timeline, merges };
    if (type === "deal") {
      out.history = await query(`SELECT id, from_name, to_name, at, created_by_name FROM sales_stage_history WHERE deal_id = ? ORDER BY at DESC`, [id]);
      const [st] = await query(`SELECT onboarding FROM sales_stages WHERE id = ?`, [row.stage_id]);
      const primary = linked.org.find(o => o.primary) || linked.org[0];
      if (primary) {
        const [o] = await query(`SELECT steward_org_id FROM sales_orgs WHERE id = ?`, [primary.id]);
        if (o && o.steward_org_id) {
          out.steward = (await LINK.facts(query, [o.steward_org_id]))[o.steward_org_id] || null;
          if (st && st.onboarding) out.onboarding = await LINK.gates(query, o.steward_org_id);
        }
      }
    }
    if (type === "org" && row.steward_org_id) out.steward = (await LINK.facts(query, [row.steward_org_id]))[row.steward_org_id] || { stewardOrgId: row.steward_org_id, missing: true };
    res.json(out);
  });

  R("patch", "/ops/sales/rec/:type/:id", async (req, res) => {
    const { type, id } = req.params;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    const r = await REC.update(ctx, type, id, b, whoOf(req), { force: b.force === true });
    if (r.ok && req.audit) req.audit.entity(`sales ${type}`, id);
    send(res, r);
  });

  R("delete", "/ops/sales/rec/:type/:id", async (req, res) => {
    const { type, id } = req.params;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const r = await REC.remove(ctx, type, id, whoOf(req));
    if (r.ok && req.audit) req.audit.entity(`sales ${type}`, id);
    send(res, r);
  });

  R("post", "/ops/sales/bulk/:type", async (req, res) => {
    const type = req.params.type;
    if (!isType(type)) return res.status(404).json({ error: "not_found" });
    const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(String))].slice(0, 2000);
    if (!ids.length) return res.status(400).json({ error: "invalid", message: "Select at least one record." });
    const who = whoOf(req);
    let done = 0; const problems = [];
    for (const id of ids) {
      let r;
      if (b.action === "delete") r = await REC.remove(ctx, type, id, who);
      else if (b.action === "owner") r = await REC.update(ctx, type, id, { owner_id: b.value || null }, who, { force: true });
      else if (b.action === "stage" && type === "deal") r = await REC.setStage(ctx, id, String(b.value || ""), who, { lostReason: b.lost_reason, revisitOn: b.revisit_on });
      else if (b.action === "set" && b.field) r = await REC.update(ctx, type, id, String(b.field).startsWith("props.") ? { props: { [String(b.field).slice(6)]: b.value } } : { [b.field]: b.value }, who, { force: true });
      else return res.status(400).json({ error: "invalid", message: "Edit a property, change the owner, change the stage, or delete." });
      if (r.ok) done++; else problems.push({ id, says: r.message || r.error });
    }
    if (req.audit) req.audit.label(`sales ${type}: ${b.action} on ${done} record${done === 1 ? "" : "s"}`);
    res.json({ ok: true, done, problems });
  });

  R("post", "/ops/sales/link", async (req, res) => {
    const { from, to, label, primary } = req.body || {};
    if (!from || !to || !isType(from.type) || !isType(to.type)) return res.status(400).json({ error: "invalid" });
    send(res, await LINKS.associate(ctx, from.type, String(from.id), to.type, String(to.id), { label, primary: primary === undefined ? null : !!primary }, whoOf(req)));
  });
  R("patch", "/ops/sales/link", async (req, res) => {
    const { from, to, label, primary } = req.body || {};
    if (!from || !to || !isType(from.type) || !isType(to.type)) return res.status(400).json({ error: "invalid" });
    send(res, await LINKS.relabel(ctx, from.type, String(from.id), to.type, String(to.id), { label, primary }));
  });
  R("post", "/ops/sales/unlink", async (req, res) => {
    const { from, to } = req.body || {};
    if (!from || !to || !isType(from.type) || !isType(to.type)) return res.status(400).json({ error: "invalid" });
    send(res, await LINKS.unassociate(ctx, from.type, String(from.id), to.type, String(to.id)));
  });

  R("post", "/ops/sales/deals/:id/stage", async (req, res) => {
    const b = req.body || {};
    send(res, await REC.setStage(ctx, req.params.id, String(b.stage_id || ""), whoOf(req), { lostReason: b.lost_reason, revisitOn: b.revisit_on }));
  });

  R("post", "/ops/sales/merge/:type", async (req, res) => {
    const b = req.body || {};
    const r = await MERGE.merge(ctx, req.params.type, String(b.keep || ""), String(b.merge || ""), whoOf(req));
    if (r.ok && req.audit) req.audit.entity(`sales ${req.params.type}`, r.id);
    send(res, r);
  });

  R("post", "/ops/sales/activities", async (req, res) => send(res, await ACT.create(ctx, req.body || {}, whoOf(req)), 201));
  R("patch", "/ops/sales/activities/:id", async (req, res) => send(res, await ACT.update(ctx, req.params.id, req.body || {}, whoOf(req))));
  R("delete", "/ops/sales/activities/:id", async (req, res) => send(res, await ACT.remove(ctx, req.params.id, whoOf(req))));
  R("get", "/ops/sales/tasks", async (req, res) => res.json({ ok: true, tasks: await ACT.tasks(query, { state: String(req.query.state || "open"), owner: req.query.owner || null }) }));

  R("post", "/ops/sales/import/preview", async (req, res) => send(res, await IMP.preview(ctx, req.body || {}, whoOf(req))));
  R("post", "/ops/sales/import/commit", async (req, res) => {
    const r = await IMP.commit(ctx, req.body || {}, whoOf(req));
    if (r.ok && req.audit) req.audit.label(`sales import: ${r.counts.created} created, ${r.counts.updated} updated, ${r.counts.skipped} skipped`);
    send(res, r);
  });
  R("post", "/ops/sales/import/:id/undo", async (req, res) => send(res, await IMP.undo(ctx, req.params.id, whoOf(req))));
  R("get", "/ops/sales/imports", async (req, res) => res.json({ ok: true, imports: await IMP.recent(query) }));

  R("post", "/ops/sales/properties", async (req, res) => {
    const b = req.body || {}, who = whoOf(req);
    if (!isType(b.object)) return res.status(400).json({ error: "invalid", message: "A property belongs to organizations, contacts or deals." });
    if (!M.PROP_TYPES.includes(b.type)) return res.status(400).json({ error: "invalid", message: `A property is one of: ${M.PROP_TYPES.join(", ")}.` });
    const label = M.clean(b.label);
    if (!label) return res.status(400).json({ error: "invalid", message: "Name the property." });
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "prop";
    if (M.OBJECTS[b.object].fields.some(f => f.key === key)) return res.status(400).json({ error: "invalid", message: `"${label}" is already a field.` });
    const options = (b.type === "picklist" || b.type === "multiselect") ? M.listOf(b.options).slice(0, 100) : [];
    const [{ p }] = await query(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM sales_properties WHERE object = ?`, [b.object]);
    const id = newId("spr");
    try {
      await run(`INSERT INTO sales_properties (id, object, key, label, type, options, position, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)`,
        [id, b.object, key, label, b.type, JSON.stringify(options), p, who.id, who.name]);
    } catch (e) { if (e && e.code === "23505") return res.status(400).json({ error: "invalid", message: `There is already a property "${label}".` }); throw e; }
    res.status(201).json({ ok: true, id, key });
  });
  R("patch", "/ops/sales/properties/:id", async (req, res) => {
    const b = req.body || {};
    const sets = [], vals = [];
    if ("label" in b) { const l = M.clean(b.label); if (!l) return res.status(400).json({ error: "invalid", message: "Name the property." }); sets.push("label = ?"); vals.push(l); }
    if ("options" in b) { sets.push("options = ?::jsonb"); vals.push(JSON.stringify(M.listOf(b.options).slice(0, 100))); }
    if ("position" in b) { sets.push("position = ?"); vals.push(Number(b.position) || 0); }
    if (!sets.length) return res.status(400).json({ error: "invalid" });
    send(res, (await run(`UPDATE sales_properties SET ${sets.join(", ")} WHERE id = ?`, [...vals, req.params.id])).changes ? { ok: true } : { error: "not_found" });
  });
  R("delete", "/ops/sales/properties/:id", async (req, res) => {
    // The definition goes; values stay in each record's props, hidden, and come back if it is made again.
    send(res, (await run(`DELETE FROM sales_properties WHERE id = ?`, [req.params.id])).changes ? { ok: true } : { error: "not_found" });
  });

  R("post", "/ops/sales/pipelines", async (req, res) => {
    const name = M.clean((req.body || {}).name);
    if (!name) return res.status(400).json({ error: "invalid", message: "Name the pipeline." });
    res.status(201).json({ ok: true, id: await PIPES.createPipeline(ctx, name, whoOf(req)) });
  });
  R("patch", "/ops/sales/pipelines/:id", async (req, res) => {
    const name = M.clean((req.body || {}).name);
    if (!name) return res.status(400).json({ error: "invalid", message: "Name the pipeline." });
    send(res, await PIPES.renamePipeline(ctx, req.params.id, name, whoOf(req)));
  });
  R("put", "/ops/sales/pipelines/:id/stages", async (req, res) => {
    const stages = (req.body || {}).stages;
    if (!Array.isArray(stages) || !stages.length) return res.status(400).json({ error: "invalid", message: "A pipeline has at least one stage." });
    send(res, await PIPES.saveStages(ctx, req.params.id, stages, whoOf(req)));
  });

  R("post", "/ops/sales/views", async (req, res) => {
    const b = req.body || {}, who = whoOf(req);
    const name = M.clean(b.name);
    if (!isType(b.object) || !name) return res.status(400).json({ error: "invalid", message: "Name the view." });
    const id = newId("svw");
    await run(`INSERT INTO sales_views (id, object, name, config, created_by, created_by_name) VALUES (?, ?, ?, ?::jsonb, ?, ?)`,
      [id, b.object, name, JSON.stringify(b.config || {}), who.id, who.name]);
    res.status(201).json({ ok: true, id });
  });
  R("delete", "/ops/sales/views/:id", async (req, res) => send(res, (await run(`DELETE FROM sales_views WHERE id = ?`, [req.params.id])).changes ? { ok: true } : { error: "not_found" }));

  R("put", "/ops/sales/settings", async (req, res) => {
    const b = req.body || {}, who = whoOf(req);
    if (b.goal) {
      const cents = Math.round(Number(b.goal.cents));
      const by = String(b.goal.by || "");
      if (!Number.isFinite(cents) || cents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(by)) return res.status(400).json({ error: "invalid", message: "A goal is a monthly amount and a day, like 2027-06-30." });
      const [y, m, d] = by.split("-").map(Number);
      const says = `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })} MRR by ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d} ${y}`;
      await run(`INSERT INTO sales_settings (key, value, created_by, created_by_name, updated_by, updated_by_name) VALUES ('goal', ?::jsonb, ?, ?, ?, ?)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by, updated_by_name = EXCLUDED.updated_by_name`,
        [JSON.stringify({ cents, by, says }), who.id, who.name, who.id, who.name]);
    }
    res.json({ ok: true, settings: await settings(query) });
  });

  R("post", "/ops/sales/orgs/:id/steward", async (req, res) => {
    const sid = (req.body || {}).stewardOrgId ? String(req.body.stewardOrgId) : null;
    if (sid) { const [o] = await query(`SELECT id FROM orgs WHERE id = ?`, [sid]); if (!o) return res.status(400).json({ error: "invalid", message: "There is no such Steward org." }); }
    const who = whoOf(req);
    const r = await run(`UPDATE sales_orgs SET steward_org_id = ?, updated_at = NOW(), updated_by = ?, updated_by_name = ? WHERE id = ? AND deleted_at IS NULL`, [sid, who.id, who.name, req.params.id]);
    send(res, r.changes ? { ok: true } : { error: "not_found" });
  });
  R("get", "/ops/sales/steward-orgs", async (req, res) => res.json({ ok: true, orgs: await LINK.candidates(query, req.query.q) }));
}

module.exports = { mount, settings };
