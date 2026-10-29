// routes/mailTypes.js · SEND-GATE-2. WHAT STEWARD SENDS FOR YOU, AND THE ONE
// SWITCH FOR EACH.
//
//   GET  /mail-types                     Settings, "What Steward sends automatically": every email, its switch, who gets it, last sent
//   GET  /mail-types/status              the top bar's chip and Home's line
//   GET  /mail-types/:key/preview        what the email looks like (the last real one, or a sample)
//   POST /mail-types/:key                THE SWITCH. The one place an email type is turned on (with confirm and who gets it)
//   GET  /going-out                      Next 7 days, Sent, Held
//   GET  /going-out/sent.csv             Sent, as a file
//   GET  /going-out/sent/:id             exactly what one person received
//   POST /going-out/skip                 Skip this person, for one email, for 7 days
//   POST /going-out/held/:id/send        send one held email, after a confirm
//   POST /donors/:id/auto-email          the donor's own setting: follows / always / never
//   POST /donors/auto-email/bulk         the same, for people picked on the Donors list
//   GET  /admin/orgs/:id/mail-types      super-admin: the same, read-only, for any org
//
// Every switch anywhere in Steward (Settings, an editor, Going out's Pause) is
// this one POST. Nothing else writes org_mail_types (tests/send-gate-2.test.js
// scans for it). Every change is one audit row, written by the audit
// middleware from req.audit, never by this file.
"use strict";
const express = require("express");
const TYPES = require("../mailTypes");
const SEND_GATE = require("../sendGate");
const GOING = require("../goingOut");

const routers = { r0: express.Router() };
const BULK_CAP = 25000;   // the same cap as GET /donors/ids (select all matching)
const fmtDay = d => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }) : null;

function mount(ctx) {
const { query, run, uuid, requireAuth, requireAdmin, requireSuperAdmin, checkWriteAccess, wrap, actor, resend, orgToday, orgTz,
  brandEmailHeaderHtml, donorFacingOrgName } = ctx;
const app = routers.r0;

async function superAdmin(req) {
  const [me] = await query("SELECT is_super_admin FROM users WHERE id = ?", [req.user.userId]);
  return !!(me && me.is_super_admin === true);
}
async function isAdmin(req) {
  const [me] = await query("SELECT role FROM users WHERE id = ?", [req.user.userId]);
  return !!(me && me.role === "admin");
}

// The org's switch (Jonathan's) and who moved it last.
async function orgMail(orgId) {
  const [o] = await query(`SELECT emails_enabled, donor_mail_set_at, donor_mail_set_by_name, onboarded_at, org_kind, is_demo_org FROM orgs WHERE id = ?`, [orgId]);
  const on = !!o && o.emails_enabled === true;
  return { on, setAt: o ? o.donor_mail_set_at : null,
    sentence: !o ? null : o.donor_mail_set_at
      ? `Steward turned email ${on ? "on" : "off"} for you on ${fmtDay(o.donor_mail_set_at)}.` : null };
}

// Every type as the page shows it. One read of each table for the org.
async function typesFor(orgId) {
  const rows = await query(`SELECT type_key, is_on, audience, set_at, set_by_name FROM org_mail_types WHERE org_id = ?`, [orgId]);
  const by = new Map(rows.map(r => [r.type_key, r]));
  const last = new Map((await query(
    `SELECT type_key, MAX(sent_at) AS last_at,
            COUNT(*) FILTER (WHERE sent_at >= date_trunc('month', NOW()))::int AS month_n
       FROM auto_mail_sent WHERE org_id = ? GROUP BY type_key`, [orgId])).map(r => [r.type_key, r]));
  return TYPES.TYPES.map(t => {
    const r = by.get(t.key), l = last.get(t.key);
    const on = !!r && r.is_on === true;
    return {
      key: t.key, group: t.group, name: t.name, short: t.short, sentence: t.sentence, turnOn: t.turnOn, offLine: t.offLine, place: t.place,
      on, audience: on ? r.audience : null,
      since: on ? `On since ${fmtDay(r.set_at)} by ${r.set_by_name || "someone on your team"}`
        : r && r.set_at ? `Off since ${fmtDay(r.set_at)}, turned off by ${r.set_by_name || "someone on your team"}` : "Off since created",
      whoGetsIt: !on ? null : r.audience === "chosen" ? "Only donors you choose" : "Everyone, from now on",
      lastSentAt: l ? l.last_at : null,
      sentThisMonth: l ? l.month_n : 0,
      lastSent: l && l.last_at ? `Last sent ${fmtDay(l.last_at)} · ${l.month_n} this month` : "Not sent yet",
    };
  });
}

async function pagePayload(req, orgId) {
  const mail = await orgMail(orgId);
  const types = await typesFor(orgId);
  return {
    mailOn: mail.on, mailSentence: mail.sentence, mailSetAt: mail.setAt,
    top: mail.on ? null : TYPES.ORG_OFF_TOP, waiting: TYPES.WAITING,
    canChange: req ? (await isAdmin(req)) && !(await superAdmin(req)) : false,
    groups: TYPES.GROUPS.map(g => ({ key: g.key, label: g.label, types: types.filter(t => t.group === g.key) })),
    always: Object.values(TYPES.EXEMPT).map(name => ({ name, sentence: TYPES.EXEMPT_SENTENCE })),
    onCount: types.filter(t => t.on).length,
  };
}

app.get("/mail-types", requireAuth, wrap(async (req, res) => {
  res.json(await pagePayload(req, req.user.orgId));
}));

// The top bar and Home. Three states: off, on (with a count), waiting.
app.get("/mail-types/status", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const mail = await orgMail(orgId);
  const on = (await typesFor(orgId)).filter(t => t.on);
  const state = !on.length ? "off" : mail.on ? "on" : "waiting";
  const list = on.map(t => t.short);
  const joined = list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  res.json({
    state, count: on.length, mailOn: mail.on, mailSentence: mail.sentence, mailSetAt: mail.setAt,
    chip: state === "off" ? "Automatic email: Off" : state === "on" ? `Automatic email: ${on.length} on` : TYPES.WAITING,
    short: state === "off" ? "Off" : state === "on" ? `${on.length} on` : "Waiting",
    home: state === "off" ? "Steward sends nothing on its own. You decide what's automatic."
      : state === "on" ? `Steward is sending ${joined} for you.`
      : `You've turned on ${joined}. ${TYPES.WAITING}.`,
    types: on.map(t => ({ key: t.key, short: t.short, whoGetsIt: t.whoGetsIt })),
  });
}));

// A preview: the last real one Steward made for this org (sent or held), or a
// sample in the org's own header.
app.get("/mail-types/:key/preview", requireAuth, wrap(async (req, res) => {
  const t = TYPES.BY_KEY[req.params.key];
  if (!t) return res.status(404).json({ error: "not_found" });
  const orgId = req.user.orgId;
  const [sent] = await query(`SELECT subject, html, sent_at FROM auto_mail_sent WHERE org_id = ? AND type_key = ? ORDER BY sent_at DESC LIMIT 1`, [orgId, t.key]);
  if (sent) return res.json({ subject: sent.subject, html: sent.html, note: `The last one Steward sent, ${fmtDay(sent.sent_at)}.` });
  const [held] = await query(`SELECT subject, payload, created_at FROM mail_blocked WHERE org_id = ? AND (type_key = ? OR kind = ANY(?::text[])) ORDER BY created_at DESC LIMIT 1`, [orgId, t.key, t.kinds]);
  if (held) {
    const p = typeof held.payload === "string" ? JSON.parse(held.payload) : held.payload;
    return res.json({ subject: held.subject, html: p.html || `<pre>${String(p.text || "")}</pre>`, note: `The last one Steward made and held, ${fmtDay(held.created_at)}.` });
  }
  const s = GOING.sampleFor(t.key);
  const name = await donorFacingOrgName(orgId, null).catch(() => null) || "your organization";
  const header = await brandEmailHeaderHtml(orgId).catch(() => "");
  res.json({ subject: s.subject.replace(/\{org\}/g, name), html: header + s.html.replace(/\{org\}/g, name), note: "A sample. The real one uses the donor's name and gift." });
}));

// THE SWITCH. On needs `confirm: true` and who gets it; off is one click.
// Only an admin at the org changes it; a Steward super-admin never turns one on.
app.post("/mail-types/:key", requireAuth, requireAdmin, wrap(async (req, res) => {
  const t = TYPES.BY_KEY[req.params.key];
  if (!t) return res.status(404).json({ error: "not_found", sentence: "There's no such email." });
  const body = req.body || {};
  if (typeof body.on !== "boolean") return res.status(400).json({ error: "on_required", sentence: "Say whether to turn it on or off." });
  const on = body.on;
  const audience = on ? body.audience : null;
  if (on && !TYPES.AUDIENCES.includes(audience)) return res.status(400).json({ error: "who_required", sentence: "Choose who gets it: everyone, or only donors you choose." });
  if (on && body.confirm !== true) {
    return res.status(400).json({ error: "confirm_required",
      sentence: audience === "chosen" ? `${t.name} will go only to donors you set to Always include.` : t.turnOn });
  }
  if (on && await superAdmin(req)) return res.status(403).json({ error: "super_admin", sentence: "A Steward super-admin can't turn an email on. Someone at the organization turns it on." });
  const orgId = req.user.orgId;
  // "On since … by [name]": the person's name, not the sign-in address actor() stamps.
  const [me] = await query("SELECT name FROM users WHERE id = ?", [req.user.userId]);
  const who = { ...actor(req), name: (me && me.name) || actor(req).name };
  const [before] = await query(`SELECT is_on, audience FROM org_mail_types WHERE org_id = ? AND type_key = ?`, [orgId, t.key]);
  const wasOn = !!before && before.is_on === true;
  if (wasOn === on && (!on || before.audience === audience)) {
    req.audit.skip("already so");
    return res.json(await pagePayload(req, orgId));
  }
  // The one write of a type's switch, on or off.
  await run(
    `INSERT INTO org_mail_types (org_id, type_key, is_on, audience, set_at, set_by, set_by_name, created_by, created_by_name)
     VALUES (?,?,?,?,NOW(),?,?,?,?)
     ON CONFLICT (org_id, type_key) DO UPDATE SET is_on = EXCLUDED.is_on, audience = EXCLUDED.audience,
       set_at = NOW(), set_by = EXCLUDED.set_by, set_by_name = EXCLUDED.set_by_name`,
    [orgId, t.key, on, audience || (before && before.audience) || "everyone", who.id, who.name, who.id, who.name]);
  req.audit.entity("org setting", `${orgId}:${t.key}`, t.name);
  req.audit.action(on ? `turned on ${t.short}` : `turned off ${t.short}`);
  req.audit.before({ on: wasOn, who_gets_it: wasOn ? before.audience : null });
  req.audit.after({ on, who_gets_it: on ? audience : null, from: String(body.from || "settings").slice(0, 40) });
  res.json(await pagePayload(req, orgId));
}));

// ── Going out ────────────────────────────────────────────────────────────
app.get("/going-out", requireAuth, wrap(async (req, res) => {
  res.json(await GOING.goingOut(ctx, req.user.orgId, { type: req.query.type || null, from: req.query.from || null, to: req.query.to || null }));
}));
app.get("/going-out/sent.csv", requireAuth, wrap(async (req, res) => {
  const out = await GOING.sentRows(ctx, req.user.orgId, { type: req.query.type || null, from: req.query.from || null, to: req.query.to || null, limit: 10000 });
  const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [["Sent", "Email", "Person", "Subject"].join(",")]
    .concat(out.map(r => [new Date(r.sentAt).toISOString(), r.typeName, r.name || "", r.subject || ""].map(esc).join(",")));
  req.audit && req.audit.action && req.audit.action("exported what Steward sent");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="steward-sent.csv"`);
  res.send(lines.join("\n") + "\n");
}));
app.get("/going-out/sent/:id", requireAuth, wrap(async (req, res) => {
  const [r] = await query(`SELECT s.*, d.name FROM auto_mail_sent s LEFT JOIN donors d ON d.id = s.donor_id AND d.org_id = s.org_id
                            WHERE s.id = ? AND s.org_id = ?`, [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "not_found" });
  res.json({ id: r.id, subject: r.subject, html: r.html, sentAt: r.sent_at, name: r.name, typeName: (TYPES.BY_KEY[r.type_key] || {}).name });
}));
app.get("/going-out/held/:id", requireAuth, wrap(async (req, res) => {
  const [r] = await query(`SELECT subject, payload, created_at FROM mail_blocked WHERE id = ? AND org_id = ?`, [req.params.id, req.user.orgId]);
  if (!r) return res.status(404).json({ error: "not_found" });
  const p = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
  res.json({ subject: r.subject, html: p.html || `<pre>${String(p.text || "")}</pre>` });
}));
app.post("/going-out/skip", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const t = TYPES.BY_KEY[req.body && req.body.typeKey];
  const donorId = req.body && String(req.body.donorId || "");
  if (!t || !donorId) return res.status(400).json({ error: "bad_request", sentence: "Say which email and which person." });
  const [d] = await query(`SELECT id, name FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [donorId, req.user.orgId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const who = actor(req);
  await run(`INSERT INTO mail_skips (id, org_id, type_key, donor_id, until, created_by, created_by_name) VALUES (?,?,?,?,NOW() + INTERVAL '7 days',?,?)`,
    ["msk_" + uuid().replace(/-/g, "").slice(0, 14), req.user.orgId, t.key, d.id, who.id, who.name]);
  req.audit.entity("donor", d.id, d.name);
  req.audit.action(`skipped ${t.short} for 7 days`);
  res.json({ skipped: true, sentence: `${d.name} won't get ${t.short} for the next 7 days.` });
}));
// Send one held email. The row is claimed first, so a double click (or two
// people) sends it once; a send that does not go gives the claim back.
app.post("/going-out/held/:id/send", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const out = await sendHeld(req, req.params.id, null);
  res.status(out.status).json(out.body);
}));
async function sendHeld(req, heldId, donorId) {
  const { orgId } = req.user;
  if (req.body?.confirm !== true) return { status: 400, body: { error: "confirm_required", sentence: "Confirm to send this message." } };
  const who = actor(req);
  const [b] = await query(
    `UPDATE mail_blocked SET sent_at = NOW(), sent_by = ?, sent_by_name = ?
      WHERE id = ? AND org_id = ? ${donorId ? "AND donor_id = ?" : ""} AND sent_at IS NULL RETURNING *`,
    [who.id, who.name, heldId, orgId, ...(donorId ? [donorId] : [])]);
  if (!b) {
    const [had] = await query(`SELECT sent_at, sent_by_name FROM mail_blocked WHERE id = ? AND org_id = ?`, [heldId, orgId]);
    if (!had) return { status: 404, body: { error: "not_found" } };
    return { status: 409, body: { error: "already_sent", sentence: `Already sent${had.sent_by_name ? " by " + had.sent_by_name : ""}.` } };
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
    return { status: off ? 409 : 502, body: { error: off ? "donor_mail_off" : "send_failed",
      sentence: off ? "Email is off for your organization, so nothing was sent." : "The message could not be sent. Nothing went out; try again in a minute." } };
  }
  if (b.donor_id) {
    const today = orgToday(await orgTz(orgId));   // ORG_TZ_SEAM_OK
    await run(`INSERT INTO interactions (id, org_id, donor_id, type, note, date, created_by, logged_by_name, metadata) VALUES (?,?,?,?,?,?,?,?,?)`,
      ["i_" + uuid().slice(0, 8), orgId, b.donor_id, "email", `Email: ${b.subject || b.what} (sent by hand; it was held)`, today, who.id, who.name,
       JSON.stringify({ via: "held_send", heldId: b.id })]).catch(() => {});
  }
  req.audit.action("sent a held email");
  if (b.donor_id) req.audit.entity("donor", b.donor_id);
  return { status: 200, body: { sent: true, sentBy: who.name } };
}

// ── The donor's own setting ──────────────────────────────────────────────
// follows (default) · always (gets emails set to "Only donors I choose") ·
// never (gets no automatic email of any kind). `on: true|false` is the
// SEND-GATE-1 switch's body, read as always|follows.
const MODE_WORDS = { follows: "Follows your settings", always: "Always include", never: "Never" };
function modeFromBody(b) {
  if (b && TYPES.MODES.includes(b.mode)) return b.mode;
  if (b && typeof b.on === "boolean") return b.on ? "always" : "follows";
  return null;
}
const MODE_SQL = { follows: [false, false], always: [true, false], never: [false, true] };
const REFUSE_SUPER = { error: "super_admin", sentence: "A Steward super-admin can't set someone to Always include. Someone at the organization does." };
const auditRow = (r, mode, who) => ({
  entityType: "donor", entityId: r.id, label: r.name,
  before: { automatic_emails: MODE_WORDS[TYPES.modeOf(r)] },
  after: { automatic_emails: MODE_WORDS[mode], set_by: who.name },
});

app.post("/donors/auto-email/bulk", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const mode = modeFromBody(req.body);
  if (!mode) return res.status(400).json({ error: "mode_required", sentence: "Choose follows your settings, always include or never." });
  const ids = Array.isArray(req.body.ids) ? [...new Set(req.body.ids.map(String))].slice(0, BULK_CAP) : [];
  if (!ids.length) return res.status(400).json({ error: "ids_required", sentence: "Pick at least one person." });
  if (mode === "always" && await superAdmin(req)) return res.status(403).json(REFUSE_SUPER);
  const [a, n] = MODE_SQL[mode];
  const rows = await query(
    `SELECT id, name, auto_email, auto_email_never FROM donors WHERE org_id = ? AND id = ANY(?::text[]) AND deleted_at IS NULL
        AND NOT (auto_email = ? AND auto_email_never = ?)`, [orgId, ids, a, n]);
  const n_ = rows.length, people = x => `${x.toLocaleString("en-US")} ${x === 1 ? "person" : "people"}`;
  if (req.body.confirm !== true) {
    req.audit && req.audit.skip && req.audit.skip("a count, nothing changed");
    return res.json({ preview: true, count: n_, already: ids.length - n_,
      sentence: n_ ? `Set automatic emails to ${MODE_WORDS[mode].toLowerCase()} for ${people(n_)}?`
        : `Everyone you picked is already set to ${MODE_WORDS[mode].toLowerCase()}.` });
  }
  if (Number(req.body.count) !== n_) {
    return res.status(409).json({ error: "count_changed", count: n_,
      sentence: `That is now ${people(n_)}, not ${Number(req.body.count) || 0}. Nothing was changed; confirm again.` });
  }
  const who = actor(req);
  if (n_) {
    await run(
      `UPDATE donors SET auto_email = ?, auto_email_never = ?, auto_email_by = ?, auto_email_by_name = ?, auto_email_at = NOW()
        WHERE org_id = ? AND id = ANY(?::text[]) AND deleted_at IS NULL`,
      [a, n, who.id, who.name, orgId, rows.map(r => r.id)]);
    req.audit.action(`set automatic emails to ${MODE_WORDS[mode].toLowerCase()}`);
    req.audit.summary(`Set automatic emails to ${MODE_WORDS[mode].toLowerCase()} for ${people(n_)} from the Donors list`, { count: n_, entityType: "donor" });
    req.audit.perRecord(rows.map(r => auditRow(r, mode, who)));
  } else req.audit.skip("nothing to change");
  res.json({ changed: n_, already: ids.length - n_, mode });
}));

app.post("/donors/:id/auto-email", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const { orgId } = req.user;
  const mode = modeFromBody(req.body);
  if (!mode) return res.status(400).json({ error: "mode_required", sentence: "Choose follows your settings, always include or never." });
  if (mode === "always" && req.body.confirm !== true) return res.status(400).json({ error: "confirm_required", sentence: "Confirm to set this person to Always include." });
  if (mode === "always" && await superAdmin(req)) return res.status(403).json(REFUSE_SUPER);
  const [d] = await query(`SELECT id, name, auto_email, auto_email_never FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const who = actor(req);
  if (TYPES.modeOf(d) !== mode) {
    const [a, n] = MODE_SQL[mode];
    await run(`UPDATE donors SET auto_email = ?, auto_email_never = ?, auto_email_by = ?, auto_email_by_name = ?, auto_email_at = NOW() WHERE id = ? AND org_id = ?`,
      [a, n, who.id, who.name, d.id, orgId]);
    req.audit.action(`set automatic emails to ${MODE_WORDS[mode].toLowerCase()}`);
    req.audit.entity("donor", d.id, d.name);
    req.audit.before({ automatic_emails: MODE_WORDS[TYPES.modeOf(d)] });
    req.audit.after({ automatic_emails: MODE_WORDS[mode] });
  } else req.audit.skip("already so");
  res.json({ mode, autoEmail: mode === "always", by: who.name, at: new Date().toISOString() });
}));

// The profile's line and held mail.
app.get("/donors/:id/blocked-mail", requireAuth, wrap(async (req, res) => {
  const orgId = req.user.orgId;
  const [d] = await query(`SELECT auto_email, auto_email_never, auto_email_by_name, auto_email_at FROM donors WHERE id = ? AND org_id = ? AND deleted_at IS NULL`, [req.params.id, orgId]);
  if (!d) return res.status(404).json({ error: "not_found" });
  const mode = TYPES.modeOf(d);
  const mail = await orgMail(orgId);
  const types = (await typesFor(orgId)).filter(t => t.on);
  const reach = mode === "never" ? [] : types.filter(t => t.audience === "everyone" || mode === "always");
  const list = reach.map(t => t.short);
  const joined = list.length <= 1 ? list.join("") : list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  const line = `Automatic emails: ${MODE_WORDS[mode].toLowerCase()}`
    + (mode === "never" ? " · this person gets none" : list.length ? ` · ${joined} ${list.length === 1 ? "is" : "are"} on` : " · none are on")
    + (list.length && !mail.on ? ` (${TYPES.WAITING.toLowerCase()})` : "");
  const rows = await query(
    `SELECT id, kind, what, subject, created_at, sent_at, sent_by_name, held_reason, type_key FROM mail_blocked
      WHERE org_id = ? AND donor_id = ? AND (sent_at IS NULL OR sent_at > NOW() - INTERVAL '30 days')
      ORDER BY created_at DESC LIMIT 50`, [orgId, req.params.id]);
  res.json({ mode, modeWords: MODE_WORDS[mode], line, autoEmail: mode === "always", by: d.auto_email_by_name || null, at: d.auto_email_at || null,
    blocked: rows.map(r => ({ id: r.id, kind: r.kind, what: r.what, subject: r.subject,
      at: r.created_at, sentAt: r.sent_at, sentBy: r.sent_by_name,
      why: TYPES.reasonSentence(r.held_reason, TYPES.BY_KEY[r.type_key || TYPES.typeOfKind(r.kind)]) })) });
}));
app.post("/donors/:id/blocked-mail/:bid/send", requireAuth, checkWriteAccess, wrap(async (req, res) => {
  const out = await sendHeld(req, req.params.bid, req.params.id);
  res.status(out.status).json(out.body);
}));

// ── Super-admin, read-only ───────────────────────────────────────────────
app.get("/admin/orgs/:id/mail-types", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [o] = await query(`SELECT id FROM orgs WHERE id = ?`, [req.params.id]);
  if (!o) return res.status(404).json({ error: "Org not found" });
  res.json(await adminTypes(o.id));
}));
app.get("/admin/orgs/:id/going-out", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [o] = await query(`SELECT id FROM orgs WHERE id = ?`, [req.params.id]);
  if (!o) return res.status(404).json({ error: "Org not found" });
  res.json({ ...(await GOING.goingOut(ctx, o.id, {})), readOnly: true });
}));
app.get("/admin/orgs/:id/going-out/sent/:sid", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [r] = await query(`SELECT subject, html FROM auto_mail_sent WHERE id = ? AND org_id = ?`, [req.params.sid, req.params.id]);
  if (!r) return res.status(404).json({ error: "not_found" });
  res.json({ subject: r.subject, html: r.html });
}));
app.get("/admin/orgs/:id/going-out/held/:hid", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [r] = await query(`SELECT subject, payload FROM mail_blocked WHERE id = ? AND org_id = ?`, [req.params.hid, req.params.id]);
  if (!r) return res.status(404).json({ error: "not_found" });
  const p = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
  res.json({ subject: r.subject, html: p.html || `<pre>${String(p.text || "")}</pre>` });
}));
}

// What would start the moment Donor mail goes on: the types on, who gets
// each, and the next 7 days' count. Read by the super-admin org panel and the
// Donor mail confirm (routes/billing.js).
async function adminTypes(orgId) {
  const ctx = adminTypes.ctx;
  const rows = await ctx.query(`SELECT type_key, is_on, audience, set_at, set_by_name FROM org_mail_types WHERE org_id = ?`, [orgId]);
  const by = new Map(rows.map(r => [r.type_key, r]));
  const next = await GOING.nextDays(ctx, orgId, { assumeMailOn: true }).catch(() => ({ groups: [] }));
  const nByType = new Map(next.groups.map(g => [g.typeKey, g.count]));
  const types = TYPES.TYPES.map(t => {
    const r = by.get(t.key);
    const on = !!r && r.is_on === true;
    return { key: t.key, name: t.name, short: t.short, on, audience: on ? r.audience : null,
      whoGetsIt: !on ? null : r.audience === "chosen" ? "chosen donors" : "everyone",
      since: on ? `On since ${fmtDay(r.set_at)} by ${r.set_by_name || "the organization"}` : "Off",
      next7: on ? (nByType.get(t.key) || 0) : 0 };
  });
  const on = types.filter(t => t.on);
  const total = on.reduce((s, t) => s + t.next7, 0);
  return { types,
    willStart: on.length
      ? `This will start: ${on.map(t => `${t.short} (${t.whoGetsIt})`).join(", ")}: ${total} ${total === 1 ? "email" : "emails"} in the next 7 days.`
      : "Nothing will start: the organization has not turned on any automatic email." };
}

module.exports = { routers, mount: ctx => { adminTypes.ctx = ctx; return mount(ctx); }, adminTypes };
