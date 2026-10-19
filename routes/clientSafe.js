// routes/clientSafe.js · CLIENT-SAFE-1. Settings → Privacy, the client flag,
// marking people in bulk or from an uploaded list (with Undo), removing email
// already logged for a client (Undo for thirty days), and the super-admin's
// switch for one org. The rules are in shared/clientSafe.js and clientSafe.js.
//
//   GET  /privacy                         the setting, the counts and the line
//   PUT  /privacy                         turn it on or off (admins)
//   GET  /privacy/clients                 everyone marked as a client
//   GET  /privacy/held                    this month's held-back details (no content)
//   POST /donors/:id/client               mark or unmark one person
//   POST /privacy/clients/mark            mark many (a list, a group): preview, then apply
//   POST /privacy/clients/upload          an uploaded list: match existing people only
//   POST /privacy/marks/:id/undo          put a bulk marking back
//   POST /donors/:id/client-email/remove  remove email already logged for them
//   GET  /privacy/removals                removals that can still be undone
//   POST /privacy/removals/:id/undo       put it back, within thirty days
//   GET  /admin/orgs/:id/privacy          super-admin: one org's setting
//   POST /admin/orgs/:id/privacy          super-admin: change it, as Steward support
"use strict";
const express = require("express");
const CSV = require("../clientSafe");

const routers = { r0: express.Router() };
const CS = () => import("../shared/clientSafe.js");

function mount(ctx) {
const { query, run, wrap, requireAuth, requireAdmin, requireSuperAdmin, checkWriteAccess, actor, uuid, aiGate } = ctx;
const app = routers.r0;

// The email Steward itself brought in: the mailbox read and the BCC address.
const LOGGED_EMAIL_SQL = `(created_by LIKE 'system:mailbox/%' OR created_by = 'system:inbound-email')`;
const MAX_MARK = 5000;

async function privacyPayload(orgId) {
  const C = await CS();
  await CSV.purgeRemovals(orgId).catch(() => {});
  const [org] = await query("SELECT client_privacy, client_privacy_changed_at, client_privacy_changed_by FROM orgs WHERE id=?", [orgId]);
  const [{ n: clients }] = await query("SELECT COUNT(*)::int AS n FROM donors WHERE org_id=? AND is_client IS TRUE AND deleted_at IS NULL", [orgId]);
  const [{ n: held }] = await query(
    `SELECT COUNT(DISTINCT COALESCE(interaction_id, id))::int AS n FROM privacy_holds
      WHERE org_id=? AND kind='health' AND created_at >= date_trunc('month', NOW())`, [orgId]);
  const gate = await aiGate(orgId);
  const on = !!org && org.client_privacy === true;
  return {
    on, label: C.SETTING_LABEL, description: C.SETTING_DESCRIPTION, flagLabel: C.FLAG_LABEL,
    clients, heldThisMonth: held,
    line: on ? C.privacyLine({ clients, heldThisMonth: held }) : null,
    aiOn: !!gate.ok, aiOffSentence: on && !gate.ok ? C.AI_OFF_SENTENCE : null,
    changedAt: org ? org.client_privacy_changed_at : null, changedBy: org ? org.client_privacy_changed_by : null,
  };
}

async function setPrivacy(orgId, on, by) {
  await run("UPDATE orgs SET client_privacy=?, client_privacy_changed_at=NOW(), client_privacy_changed_by=? WHERE id=?", [!!on, by, orgId]);
}

app.get("/privacy", requireAuth, wrap(async (req, res) => {
  res.json(await privacyPayload(req.user.orgId));
}));

// Only an admin changes it, and the audit row says which way it went.
app.put("/privacy", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (typeof (req.body && req.body.on) !== "boolean") return res.status(400).json({ error: "on (boolean) required" });
  const C = await CS();
  await setPrivacy(req.user.orgId, req.body.on, actor(req).name || actor(req).id);
  req.audit.entity("org setting", req.user.orgId, C.SETTING_LABEL);
  req.audit.action(req.body.on ? "turned on" : "turned off");
  res.json(await privacyPayload(req.user.orgId));
}));

app.get("/privacy/clients", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT id, name, email FROM donors WHERE org_id=? AND is_client IS TRUE AND deleted_at IS NULL ORDER BY name LIMIT 5000`, [req.user.orgId]);
  res.json({ sentence: "People marked as clients. Steward never brings in their email, documents or memos while privacy mode is on.", people: rows });
}));

// Which emails had something held back, and when. Never what.
app.get("/privacy/held", requireAuth, wrap(async (req, res) => {
  const rows = await query(
    `SELECT h.interaction_id, MIN(h.created_at) AS at, MIN(h.source) AS source,
            ARRAY_AGG(DISTINCT d.name) FILTER (WHERE d.name IS NOT NULL) AS people
       FROM privacy_holds h LEFT JOIN donors d ON d.id = h.donor_id AND d.org_id = h.org_id
      WHERE h.org_id=? AND h.kind='health' AND h.created_at >= date_trunc('month', NOW())
      GROUP BY COALESCE(h.interaction_id, h.id), h.interaction_id ORDER BY at DESC`, [req.user.orgId]);
  res.json({ sentence: "Emails this month where Steward held back a health detail. What was held back is not stored; open the email in your mailbox to read it.",
    rows: rows.map(r => ({ interactionId: r.interaction_id, at: r.at, source: r.source, people: r.people || [] })) });
}));

// ── ONE PERSON ─────────────────────────────────────────────────────────────
async function loggedEmailCount(orgId, donorId) {
  const [{ n }] = await query(`SELECT COUNT(*)::int AS n FROM interactions WHERE org_id=? AND donor_id=? AND type='email' AND ${LOGGED_EMAIL_SQL}`, [orgId, donorId]);
  return n;
}
app.post("/donors/:id/client", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  if (typeof (req.body && req.body.on) !== "boolean") return res.status(400).json({ error: "on (boolean) required" });
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  await run("UPDATE donors SET is_client=? WHERE id=? AND org_id=?", [req.body.on, d.id, orgId]);
  req.audit.action(req.body.on ? "marked as a client" : "unmarked as a client");
  res.json({ id: d.id, isClient: req.body.on, loggedEmail: req.body.on ? await loggedEmailCount(orgId, d.id) : 0 });
}));

// ── MANY PEOPLE: a list or a group's members ───────────────────────────────
async function applyMark(req, ids, source) {
  const orgId = req.user.orgId;
  const fresh = (await query(
    "SELECT id FROM donors WHERE org_id=? AND id = ANY(?::text[]) AND deleted_at IS NULL AND is_client IS NOT TRUE", [orgId, ids])).map(r => r.id);
  const markId = "cm_" + uuid().slice(0, 12);
  if (fresh.length) await run("UPDATE donors SET is_client=true WHERE org_id=? AND id = ANY(?::text[])", [orgId, fresh]);
  await run("INSERT INTO client_marks (id,org_id,source,donor_ids,created_by,created_by_name) VALUES (?,?,?,?,?,?)",
    [markId, orgId, source, JSON.stringify(fresh), actor(req).id, actor(req).name]);
  req.audit.summary(`Marked ${fresh.length} ${fresh.length === 1 ? "person" : "people"} as clients (${source}).`, { count: fresh.length, entityType: "donor" });
  return { markId, marked: fresh.length,
    sentence: `${fresh.length} ${fresh.length === 1 ? "person is" : "people are"} now marked as clients.` };
}

app.post("/privacy/clients/mark", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const ids = [...new Set((Array.isArray(req.body && req.body.donorIds) ? req.body.donorIds : []).map(String))].slice(0, MAX_MARK);
  if (!ids.length) return res.status(400).json({ error: "donorIds required" });
  const people = await query("SELECT id, name, email, is_client FROM donors WHERE org_id=? AND id = ANY(?::text[]) AND deleted_at IS NULL ORDER BY name", [orgId, ids]);
  if (req.body.apply !== true) {
    req.audit.skip("preview");
    return res.json({ preview: true, matched: people.map(p => ({ id: p.id, name: p.name, email: p.email || "", already: p.is_client === true })) });
  }
  res.json(await applyMark(req, people.map(p => p.id), req.body.source === "group" ? "group" : "list"));
}));

// An uploaded list (names and emails, e.g. a program system's export). It
// matches people ALREADY on file and never creates one: by exact email first,
// then by exact name when exactly one person has it.
app.post("/privacy/clients/upload", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const rows = (Array.isArray(req.body && req.body.rows) ? req.body.rows : []).slice(0, MAX_MARK);
  if (!rows.length) return res.status(400).json({ error: "rows required", sentence: "The list is empty." });
  const people = await query("SELECT id, name, email, is_client FROM donors WHERE org_id=? AND deleted_at IS NULL", [orgId]);
  const byEmail = new Map(), byName = new Map();
  const nm = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  for (const p of people) {
    if (p.email) byEmail.set(nm(p.email), p);
    const k = nm(p.name); if (k) byName.set(k, byName.has(k) ? null : p);   // a shared name matches nobody
  }
  const matched = new Map();
  let unmatched = 0;
  for (const r of rows) {
    const e = nm(r && r.email), n = nm(r && r.name);
    const p = (e && byEmail.get(e)) || (n && byName.get(n)) || null;
    if (p) matched.set(p.id, { id: p.id, name: p.name, email: p.email || "", already: p.is_client === true, by: e && byEmail.get(e) ? "email" : "name" });
    else unmatched++;
  }
  const list = [...matched.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const unmatchedSentence = unmatched
    ? `${unmatched} ${unmatched === 1 ? "line matches" : "lines match"} nobody on file and ${unmatched === 1 ? "is" : "are"} left out. Steward never adds people from this list.` : null;
  if (req.body.apply !== true) {
    req.audit.skip("preview");
    return res.json({ preview: true, matched: list, unmatched, unmatchedSentence });
  }
  res.json({ ...(await applyMark(req, list.map(p => p.id), "upload")), unmatched, unmatchedSentence });
}));

app.post("/privacy/marks/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [m] = await query("SELECT * FROM client_marks WHERE id=? AND org_id=? AND undone_at IS NULL", [req.params.id, orgId]);
  if (!m) return res.status(404).json({ error: "Not found" });
  const ids = typeof m.donor_ids === "string" ? JSON.parse(m.donor_ids) : (m.donor_ids || []);
  if (ids.length) await run("UPDATE donors SET is_client=false WHERE org_id=? AND id = ANY(?::text[])", [orgId, ids]);
  await run("UPDATE client_marks SET undone_at=NOW() WHERE id=? AND org_id=?", [m.id, orgId]);
  req.audit.summary(`Undid marking ${ids.length} ${ids.length === 1 ? "person" : "people"} as clients.`, { count: ids.length, entityType: "donor" });
  res.json({ undone: true, unmarked: ids.length });
}));

// ── EMAIL ALREADY LOGGED FOR SOMEONE NOW MARKED AS A CLIENT ────────────────
// Only what Steward brought in itself (the mailbox read and the BCC address);
// a note somebody typed is theirs to remove. Kept thirty days for Undo, then
// emptied for good (clientSafe.js purgeRemovals).
app.post("/donors/:id/client-email/remove", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query("SELECT id, name FROM donors WHERE id=? AND org_id=? AND deleted_at IS NULL", [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "Donor not found" });
  const rows = await query(`SELECT * FROM interactions WHERE org_id=? AND donor_id=? AND type='email' AND ${LOGGED_EMAIL_SQL}`, [orgId, d.id]);
  const id = "cer_" + uuid().slice(0, 12);
  await run(`INSERT INTO client_email_removals (id,org_id,donor_id,count,rows,created_by,created_by_name) VALUES (?,?,?,?,?,?,?)`,
    [id, orgId, d.id, rows.length, JSON.stringify(rows), actor(req).id, actor(req).name]);
  if (rows.length) {
    await run("DELETE FROM interactions WHERE org_id=? AND id = ANY(?::text[])", [orgId, rows.map(r => r.id)]);
    await run("DELETE FROM privacy_holds WHERE org_id=? AND interaction_id = ANY(?::text[])", [orgId, rows.map(r => r.id)]);
  }
  req.audit.summary(`Removed ${rows.length} logged ${rows.length === 1 ? "email" : "emails"} for a person marked as a client.`, { count: rows.length, entityType: "interaction" });
  res.json({ removalId: id, removed: rows.length,
    sentence: `${rows.length} logged ${rows.length === 1 ? "email" : "emails"} removed from ${d.name}'s record. You can undo this for ${CSV.REMOVAL_UNDO_DAYS} days.` });
}));

app.get("/privacy/removals", requireAuth, wrap(async (req, res) => {
  await CSV.purgeRemovals(req.user.orgId).catch(() => {});
  const rows = await query(
    `SELECT r.id, r.donor_id, d.name, r.count, r.created_at, r.created_by_name FROM client_email_removals r
       LEFT JOIN donors d ON d.id = r.donor_id AND d.org_id = r.org_id
      WHERE r.org_id=? AND r.undone_at IS NULL AND r.purged_at IS NULL ORDER BY r.created_at DESC LIMIT 200`, [req.user.orgId]);
  res.json({ sentence: `Email removed from people marked as clients. Each can be put back for ${CSV.REMOVAL_UNDO_DAYS} days, then it is gone for good.`,
    rows: rows.map(r => ({ id: r.id, donorId: r.donor_id, name: r.name, count: r.count, at: r.created_at, by: r.created_by_name })) });
}));

app.post("/privacy/removals/:id/undo", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  await CSV.purgeRemovals(orgId).catch(() => {});
  const [r] = await query("SELECT * FROM client_email_removals WHERE id=? AND org_id=? AND undone_at IS NULL", [req.params.id, orgId]);
  if (!r) return res.status(404).json({ error: "Not found" });
  if (r.purged_at || !r.rows) return res.status(410).json({ error: "gone", sentence: `That was more than ${CSV.REMOVAL_UNDO_DAYS} days ago, so it is gone for good.` });
  const rows = typeof r.rows === "string" ? JSON.parse(r.rows) : r.rows;
  for (const x of rows) {
    await run(`INSERT INTO interactions (id,org_id,donor_id,type,note,date,created_by,created_at,logged_by_name,metadata)
               VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`,
      [x.id, orgId, x.donor_id, x.type, x.note, x.date, x.created_by, x.created_at, x.logged_by_name,
       x.metadata == null ? null : (typeof x.metadata === "string" ? x.metadata : JSON.stringify(x.metadata))]);
  }
  await run("UPDATE client_email_removals SET undone_at=NOW(), rows=NULL WHERE id=? AND org_id=?", [r.id, orgId]);
  res.json({ undone: true, restored: rows.length });
}));

// ── SUPER-ADMIN: ONE ORG'S SETTING, CHANGED AS STEWARD SUPPORT ─────────────
// The row lands in THAT org's audit log, and it names Steward support, not a
// member of their team.
app.get("/admin/orgs/:id/privacy", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [o] = await query("SELECT id FROM orgs WHERE id=?", [req.params.id]);
  if (!o) return res.status(404).json({ error: "Org not found" });
  res.json(await privacyPayload(o.id));
}));
app.post("/admin/orgs/:id/privacy", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [o] = await query("SELECT id FROM orgs WHERE id=?", [req.params.id]);
  if (!o) return res.status(404).json({ error: "Org not found" });
  if (typeof (req.body && req.body.on) !== "boolean") return res.status(400).json({ error: "on (boolean) required" });
  const C = await CS();
  await setPrivacy(o.id, req.body.on, C.SUPPORT_ACTOR);
  req.audit.forOrg(o.id);
  req.audit.actor({ kind: "support", id: "support:" + req.user.userId, name: C.SUPPORT_ACTOR });
  req.audit.entity("org setting", o.id, C.SETTING_LABEL);
  req.audit.action(req.body.on ? "turned on" : "turned off");
  res.json(await privacyPayload(o.id));
}));
}

module.exports = { routers, mount };
