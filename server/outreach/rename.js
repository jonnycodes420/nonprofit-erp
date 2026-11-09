// server/outreach/rename.js · POLISH-8 (W-1109-Fundraising-16X). RENAME IN PLACE.
//
// "General appeal" was two drafts, two templates and two Reports filter entries,
// with nothing to tell them apart. Every list with two rows of one name now
// shows a disambiguator (shared/dupeNames.js) and a Rename beside it. A rename
// is the name only: it never touches a campaign's words, status or approval
// (PUT /campaigns/:id rewrites subject and body and refuses a sent campaign),
// so a sent campaign can be renamed too.
//
//   POST /campaigns/:id/rename        { name }
//   POST /email-templates/:id/rename  { name }
// The audit row is middleware/auditTrail.js's; this only names the entity.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const MAX = 200;
const TABLES = { "campaigns": { table: "campaigns", entity: "campaign" }, "email-templates": { table: "email_templates", entity: "email_template" } };

function cleanName(v) {
  const s = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  return s && s.length <= MAX ? s : null;
}

function mount(ctx) {
  const { query, requireAuth, checkWriteAccess, wrap } = ctx;
  const app = routers.r1;
  const gate = checkWriteAccess || ((req, res, next) => next());
  for (const [path, t] of Object.entries(TABLES)) {
    app.post(`/${path}/:id/rename`, requireAuth, gate, wrap(async (req, res) => {
      const name = cleanName(req.body && req.body.name);
      if (!name) return res.status(400).json({ error: "bad_name", sentence: `Give it a name of 1 to ${MAX} characters.` });
      const [row] = await query(`UPDATE ${t.table} SET name = ?, updated_at = NOW() WHERE id = ? AND org_id = ? RETURNING id, name`, [name, req.params.id, req.user.orgId]);
      if (!row) return res.status(404).json({ error: "not_found" });
      if (req.audit && req.audit.entity) req.audit.entity(t.entity, row.id, row.name);
      res.json({ id: row.id, name: row.name });
    }));
  }
}

module.exports = { routers, mount, cleanName };
