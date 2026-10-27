// routes/donorList.js · LIST-1. THE DONOR LIST'S COLUMNS, VIEWS AND FILTER.
//
//   GET    /donors/list-setup         every field, this person's layout, their views
//   PUT    /donors/list-layout        save this person's columns, widths, page size
//   DELETE /donors/list-layout        back to the org's default (or Steward's)
//   PUT    /donors/list-layout/org    an admin sets the org's default
//   POST   /donors/list-views         name the current columns plus filter
//   DELETE /donors/list-views/:id     one of your own views
//   GET    /donors/ids                every id the list's filter matches (select all)
//   POST   /donors/bulk-tag           add one tag to the people picked
//
// A layout belongs to one person: another person's list never moves because
// somebody reordered theirs. The rows themselves come from GET /donors with
// `cols=` and `where=` (routes/crm.js), through groups.js buildDonorFilter.
// Declared ahead of crm.js's /donors/:id (Express order).
"use strict";
const express = require("express");
const DL = require("../donorList");

const routers = { r0: express.Router() };
const IDS_CAP = 25000;

function mount(ctx) {
const { query, run, uuid, requireAuth, requireCrm, checkWriteAccess, wrap, actor } = ctx;
// The Donors list's own filter, as GET /donors runs it (archived people off
// the list unless ?archived=1 asks for only them).
const buildListFilter = async req => {
  const GR = require("../groups");
  const q = req.query || {};
  if (String(q.archived || "") === "1") return GR.buildDonorFilter(req.user.orgId, q).then(f => (f.whereSql ? { ...f, whereSql: `${f.whereSql} AND archived_at IS NOT NULL` } : f));
  return GR.buildDonorFilter(req.user.orgId, q, { hideArchived: true });
};
const app = routers.r0;
const isAdmin = req => req.user && req.user.role === "admin";
const knownCols = async orgId => new Set((await DL.fieldsFor(orgId)).filter(f => f.col).map(f => f.key));
const viewOut = (v, userId) => ({ id: v.id, name: v.name, columns: v.columns, widths: v.widths || {}, filters: v.filters || null,
  pageSize: v.page_size, mine: v.user_id === userId });

app.get("/donors/list-setup", requireAuth, requireCrm, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const [fields, layout, views, [geo]] = await Promise.all([
    DL.fieldsFor(orgId),
    DL.layoutFor(orgId, userId),
    query(`SELECT * FROM donor_list_views WHERE org_id = ? AND user_id = ? ORDER BY lower(name)`, [orgId, userId]),
    query(`SELECT EXISTS (SELECT 1 FROM donors WHERE org_id = ? AND deleted_at IS NULL AND latitude IS NOT NULL) AS on`, [orgId]),
  ]);
  // Room to give is a column only for someone who may see the word.
  const mayRoom = await require("../prospect").canSee(userId);
  const shown = fields.filter(f => !f.majorGifts || mayRoom);
  const known = new Set(shown.filter(f => f.col).map(f => f.key));
  // A column whose field has gone (an archived custom field) leaves quietly.
  res.json({
    groups: DL.GROUPS, fields: shown.map(DL.publicField), defaultColumns: DL.DEFAULT_COLUMNS, pageSizes: DL.PAGE_SIZES,
    layout: { ...layout, columns: layout.columns.filter(k => known.has(k)) },
    views: views.map(v => viewOut(v, userId)),
    canSetOrgDefault: isAdmin(req), hasGeocoding: !!(geo && geo.on),
  });
}));

app.put("/donors/list-layout", requireAuth, requireCrm, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const layout = DL.cleanLayout(req.body, await knownCols(orgId));
  await DL.saveLayout(orgId, userId, layout, actor(req));
  res.json({ layout: { ...layout, source: "mine" } });
}));

app.delete("/donors/list-layout", requireAuth, requireCrm, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  await run(`DELETE FROM donor_list_layouts WHERE org_id = ? AND user_id = ?`, [orgId, userId]);
  res.json({ layout: await DL.layoutFor(orgId, userId) });
}));

app.put("/donors/list-layout/org", requireAuth, requireCrm, wrap(async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "admin_only", sentence: "Only an admin sets the list everyone starts from." });
  const { orgId } = req.user;
  const layout = DL.cleanLayout(req.body, await knownCols(orgId));
  await DL.saveLayout(orgId, "", layout, actor(req));
  res.json({ layout: { ...layout, source: "org" } });
}));

app.post("/donors/list-views", requireAuth, requireCrm, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const name = String((req.body && req.body.name) || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "name_required", sentence: "Give the view a name." });
  const layout = DL.cleanLayout(req.body, await knownCols(orgId));
  let filters = null;
  if (req.body && req.body.filters) {
    const p = DL.parseWhere(req.body.filters);
    if (p.error) return res.status(400).json({ error: "bad_filter", sentence: p.error });
    filters = p.where;
  }
  const id = `lv_${uuid().slice(0, 12)}`;
  const who = actor(req);
  await run(`INSERT INTO donor_list_views (id, org_id, user_id, name, columns, widths, filters, page_size, created_by, created_by_name)
             VALUES (?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?)`,
    [id, orgId, userId, name, JSON.stringify(layout.columns), JSON.stringify(layout.widths), filters ? JSON.stringify(filters) : null,
     layout.pageSize, who.id, who.name]);
  const [v] = await query(`SELECT * FROM donor_list_views WHERE id = ? AND org_id = ?`, [id, orgId]);
  res.json({ view: viewOut(v, userId) });
}));

app.delete("/donors/list-views/:id", requireAuth, requireCrm, wrap(async (req, res) => {
  const { orgId, userId } = req.user;
  const r = await run(`DELETE FROM donor_list_views WHERE id = ? AND org_id = ? AND user_id = ?`, [req.params.id, orgId, userId]);
  if (!r.changes) return res.status(404).json({ error: "not_found", sentence: "That view isn't one of yours." });
  res.json({ deleted: true });
}));

// Every id the list's filter matches, in the list's order: "select all N".
app.get("/donors/ids", requireAuth, requireCrm, wrap(async (req, res) => {
  const f = await buildListFilter(req);
  if (f.badFilter) return res.status(400).json({ error: "bad_filter", sentence: f.badFilter });
  if (f.badRole || f.badStatus) return res.status(400).json({ error: "bad_filter", sentence: "One of those choices isn't one Steward knows." });
  const rows = await query(`SELECT id FROM donors WHERE ${f.whereSql} ORDER BY total_giving DESC, id LIMIT ?`,
    [...f.params, IDS_CAP + 1]);
  res.json({ ids: rows.slice(0, IDS_CAP).map(r => r.id), total: rows.length > IDS_CAP ? null : rows.length, capped: rows.length > IDS_CAP });
}));

// One tag, added to the people picked (never removed, never duplicated).
app.post("/donors/bulk-tag", requireAuth, requireCrm, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const tag = String((req.body && req.body.tag) || "").trim().slice(0, 60);
  const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))].slice(0, IDS_CAP) : [];
  if (!tag) return res.status(400).json({ error: "tag_required", sentence: "Type the tag to add." });
  if (!ids.length) return res.status(400).json({ error: "ids_required", sentence: "Pick at least one person." });
  const rows = await query(`SELECT id, tags FROM donors WHERE org_id = ? AND id = ANY(?) AND deleted_at IS NULL`, [orgId, ids]);
  const changed = [];
  for (const r of rows) {
    let tags = [];
    try { tags = Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || "[]"); } catch { tags = []; }
    if (!Array.isArray(tags)) tags = [];
    if (tags.some(t => String(t).toLowerCase() === tag.toLowerCase())) continue;
    changed.push([r.id, JSON.stringify([...tags, tag])]);
  }
  if (changed.length) {
    await run(`UPDATE donors SET tags = v.tags FROM (SELECT * FROM UNNEST(?::text[], ?::text[]) AS t(id, tags)) v
                WHERE donors.id = v.id AND donors.org_id = ?`, [changed.map(c => c[0]), changed.map(c => c[1]), orgId]);
    req.audit && req.audit.action && req.audit.action(`added the tag "${tag}" to ${changed.length} ${changed.length === 1 ? "person" : "people"}`);
    // A tag can move someone into a group by rule.
    await require("../afterChange").afterChange(orgId, changed.map(c => c[0]), { door: "list_tag", recalc: false }).catch(() => {});
  }
  res.json({ tagged: changed.length, already: rows.length - changed.length });
}));
}

module.exports = { routers, mount };
