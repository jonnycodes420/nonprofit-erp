// routes/autoEmail.js · SEND-GATE-1. WHO GETS AUTOMATIC EMAIL, AND WHAT WAS HELD.
//
//   POST /donors/auto-email/bulk               the Donors list's "Turn on / off automatic emails"
//   POST /donors/:id/auto-email                the switch on one profile
//   GET  /donors/:id/blocked-mail              what Steward did not send this person
//   POST /donors/:id/blocked-mail/:bid/send    send that one message, once
//
// The switch is turned on only here, by a person on staff in this org pressing
// it and confirming. A super-admin account may turn it off, never on: "the org
// turned it on" has to be true. Every change is one audit row per person,
// written by the audit middleware (req.audit.perRecord), never by this file.
// Declared ahead of crm.js's /donors/:id (Express order).
"use strict";
const express = require("express");
const SEND_GATE = require("../sendGate");

const routers = { r0: express.Router() };
const BULK_CAP = 25000;   // the same cap as GET /donors/ids (select all matching)

function mount(ctx) {
const { query, run, uuid, requireAuth, checkWriteAccess, wrap, actor, resend, orgToday, orgTz } = ctx;
const app = routers.r0;

async function superAdmin(req) {
  const [me] = await query("SELECT is_super_admin FROM users WHERE id = ?", [req.user.userId]);
  return !!(me && me.is_super_admin === true);
}
const REFUSE_SUPER = { error: "super_admin", sentence: "A Steward super-admin can't turn automatic emails on. Someone at the organization turns them on." };
const auditRow = (r, on, who) => ({
  entityType: "donor", entityId: r.id, label: r.name,
  before: { auto_email: r.auto_email === true },
  after: { auto_email: on, auto_email_by_name: who.name },
});

// The bulk switch. Without `confirm`, says how many people it would change and
// changes nothing. With `confirm: true` and that same `count`, changes exactly
// those people; a count that no longer matches is refused, so the number she
// confirmed is the number that changed.
app.post("/donors/auto-email/bulk", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const on = req.body && req.body.on === true;
  if (!req.body || typeof req.body.on !== "boolean") return res.status(400).json({ error: "on_required", sentence: "Say whether to turn automatic emails on or off." });
  const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))].slice(0, BULK_CAP) : [];
  if (!ids.length) return res.status(400).json({ error: "ids_required", sentence: "Pick at least one person." });
  if (on && await superAdmin(req)) return res.status(403).json(REFUSE_SUPER);
  const rows = await query(
    `SELECT id, name, auto_email FROM donors WHERE org_id = ? AND id = ANY(?::text[]) AND deleted_at IS NULL AND auto_email <> ?`,
    [orgId, ids, on]);
  const verb = on ? "on" : "off";
  if (req.body.confirm !== true) {
    req.audit && req.audit.skip && req.audit.skip("a count, nothing changed");
    return res.json({ preview: true, count: rows.length, already: ids.length - rows.length,
      sentence: rows.length
        ? `Turn automatic emails ${verb} for ${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "person" : "people"}?`
        : `Automatic emails are already ${verb} for everyone you picked.` });
  }
  if (Number(req.body.count) !== rows.length) {
    return res.status(409).json({ error: "count_changed", count: rows.length,
      sentence: `That is now ${rows.length.toLocaleString("en-US")} ${rows.length === 1 ? "person" : "people"}, not ${Number(req.body.count) || 0}. Nothing was changed; confirm again.` });
  }
  const who = actor(req);
  if (rows.length) {
    await run(
      `UPDATE donors SET auto_email = ?, auto_email_by = ?, auto_email_by_name = ?, auto_email_at = NOW()
        WHERE org_id = ? AND id = ANY(?::text[]) AND deleted_at IS NULL`,
      [on, who.id, who.name, orgId, rows.map(r => r.id)]);
    req.audit.action(`turned automatic emails ${verb}`);
    req.audit.summary(`Turned automatic emails ${verb} for ${rows.length} ${rows.length === 1 ? "person" : "people"} from the Donors list`, { count: rows.length, entityType: "donor" });
    req.audit.perRecord(rows.map(r => auditRow(r, on, who)));
  } else req.audit.skip("nothing to change");
  res.json({ changed: rows.length, already: ids.length - rows.length });
}));

app.post("/donors/:id/auto-email", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  if (!req.body || typeof req.body.on !== "boolean") return res.status(400).json({ error: "on_required", sentence: "Say whether to turn automatic emails on or off." });
  const on = req.body.on;
  if (on && req.body.confirm !== true) return res.status(400).json({ error: "confirm_required", sentence: "Confirm to turn automatic emails on." });
  if (on && await superAdmin(req)) return res.status(403).json(REFUSE_SUPER);
  const [d] = await query(`SELECT id, name, auto_email FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const who = actor(req);
  if (d.auto_email !== on) {
    await run(`UPDATE donors SET auto_email = ?, auto_email_by = ?, auto_email_by_name = ?, auto_email_at = NOW() WHERE id = ? AND org_id = ?`,
      [on, who.id, who.name, d.id, orgId]);
    req.audit.action(`turned automatic emails ${on ? "on" : "off"}`);
    req.audit.entity("donor", d.id, d.name);
  } else req.audit.skip("already so");
  res.json({ autoEmail: on, by: who.name, at: new Date().toISOString() });
}));

app.get("/donors/:id/blocked-mail", requireAuth, wrap(async (req, res) => {
  const [d] = await query(`SELECT auto_email, auto_email_by_name, auto_email_at FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const rows = await query(
    `SELECT id, kind, what, subject, created_at, sent_at, sent_by_name FROM mail_blocked
      WHERE org_id = ? AND donor_id = ? AND (sent_at IS NULL OR sent_at > NOW() - INTERVAL '30 days')
      ORDER BY created_at DESC LIMIT 50`, [req.user.orgId, req.params.id]);
  res.json({ autoEmail: d.auto_email === true, by: d.auto_email_by_name || null, at: d.auto_email_at || null,
    blocked: rows.map(r => ({ id: r.id, kind: r.kind, what: r.what, subject: r.subject,
    at: r.created_at, sentAt: r.sent_at, sentBy: r.sent_by_name })) });
}));

// Send the one held message. The row is claimed first, so a double click (or
// two people) sends it once; a send that does not go gives the claim back.
app.post("/donors/:id/blocked-mail/:bid/send", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  if (req.body?.confirm !== true) return res.status(400).json({ error: "confirm_required", sentence: "Confirm to send this message." });
  const who = actor(req);
  const [b] = await query(
    `UPDATE mail_blocked SET sent_at = NOW(), sent_by = ?, sent_by_name = ?
      WHERE id = ? AND org_id = ? AND donor_id = ? AND sent_at IS NULL RETURNING *`,
    [who.id, who.name, req.params.bid, orgId, req.params.id]);
  if (!b) {
    const [had] = await query(`SELECT sent_at, sent_by_name FROM mail_blocked WHERE id = ? AND org_id = ? AND donor_id = ?`, [req.params.bid, orgId, req.params.id]);
    if (!had) return res.status(404).json({ error: "not_found" });
    return res.status(409).json({ error: "already_sent", sentence: `Already sent${had.sent_by_name ? " by " + had.sent_by_name : ""}.` });
  }
  const payload = typeof b.payload === "string" ? JSON.parse(b.payload) : b.payload;
  const to = SEND_GATE.recipientsOf(payload)[0];
  const giveBack = () => run(`UPDATE mail_blocked SET sent_at = NULL, sent_by = NULL, sent_by_name = NULL WHERE id = ?`, [b.id]);
  let out;
  try {
    const confirm = await SEND_GATE.recordStaffConfirm({ orgId, to, what: b.what, by: who });
    out = await resend.emails.send({ ...payload, _stewardOrgId: orgId, _stewardKind: b.kind || "supporter",
      _stewardDonorId: b.donor_id, _stewardConfirm: confirm });
  } catch (e) { out = { error: { message: e.message } }; }
  if (out && out.error) {
    await giveBack();
    const off = out.error.name === "org_mail_off";
    return res.status(off ? 409 : 502).json({ error: off ? "donor_mail_off" : "send_failed",
      sentence: off ? "Donor mail is switched off for your organization, so nothing was sent." : "The message could not be sent. Nothing went out; try again in a minute." });
  }
  const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
  await run(`INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata) VALUES (?,?,?,?,?,?,?,?,?)`,
    ["i_" + uuid().slice(0, 8), orgId, b.donor_id, "email", `Email: ${b.subject || b.what} (sent by hand; automatic emails are off)`, today, who.id, who.name,
     JSON.stringify({ via: "held_send", heldId: b.id })]).catch(() => {});
  req.audit.action("sent a held email");
  req.audit.entity("donor", b.donor_id);
  res.json({ sent: true, sentBy: who.name });
}));
}

module.exports = { routers, mount };
