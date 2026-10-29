// routes/supportAccess.js · FIX-57. OPEN AS SUPPORT, AND THE ORG'S OFF SWITCH.
//
//   POST /admin/orgs/:id/support/open      super-admin: a read-only session in that org
//   POST /support-session/allow-changes    the second confirm, from inside the session
//   POST /support-session/end              ends it
//   GET  /support-access                   the org's setting (admins)
//   PUT  /support-access                   an admin of the org turns it on or off
//
// The rules live in supportAccess.js and in requireAuth (auth.js), which is
// the one door every request passes: that is where read-only is enforced.
// No route here writes an audit row; each improves the one the middleware
// writes (req.audit.*), and the open is filed in the ORG's Activity.
"use strict";
const express = require("express");
const S = require("../supportAccess");

const routers = { r0: express.Router() };

function mount(ctx) {
const { query, run, wrap, requireAuth, requireAdmin, requireSuperAdmin, uuid } = ctx;
const app = routers.r0;
const { signSupportToken } = require("../auth");

app.post("/admin/orgs/:id/support/open", requireAuth, requireSuperAdmin, wrap(async (req, res) => {
  const [org] = await query("SELECT * FROM orgs WHERE id=?", [req.params.id]);
  if (!org) return res.status(404).json({ error: "Org not found" });
  if (org.support_access_off === true) {
    return res.status(403).json({ error: "support_access_off", message: S.SUPPORT_OFF });
  }
  const [me] = await query("SELECT id, name, email FROM users WHERE id=?", [req.user.userId]);
  const name = S.supportName(me && me.name, me && me.email);
  const sid = "sup_" + uuid().replace(/-/g, "").slice(0, 16);
  const now = new Date();
  const expires = new Date(now.getTime() + S.SUPPORT_HOURS * 3600 * 1000);
  await run(`INSERT INTO support_sessions (id, org_id, user_id, support_name, created_by, created_by_name, started_at, expires_at)
             VALUES (?,?,?,?,?,?,?,?)`, [sid, org.id, req.user.userId, name, req.user.userId, name, now, expires]);
  const sentence = `Steward support viewed your account, ${S.orgClock(now, org.timezone)}`;
  // The row lands in THAT org's Activity, named as support.
  req.audit.forOrg(org.id);
  req.audit.actor({ kind: "support", id: "support:" + req.user.userId, name });
  req.audit.entity("support session", sid, name);
  req.audit.action("viewed your account");
  req.audit.summary(sentence);
  const token = signSupportToken({ userId: req.user.userId, orgId: org.id, email: me && me.email, role: "admin",
                                   isSuperAdmin: true, supportSid: sid });
  res.json({
    token,
    user: { id: req.user.userId, email: me && me.email, name: (me && me.name) || name, role: "admin", isSuperAdmin: false,
            support: { id: sid, name, writable: false, orgName: org.name, expiresAt: expires } },
    org,
    sentence,
  });
}));

// Only from inside a support session.
const supportOnly = (req, res, next) => (req.user && req.user.support)
  ? next() : res.status(403).json({ error: "not_a_support_session", message: "This is only for a Steward support session." });

app.post("/support-session/allow-changes", requireAuth, supportOnly, wrap(async (req, res) => {
  if (!req.body || req.body.confirm !== true) {
    return res.status(400).json({ error: "confirm_required",
      message: "Allowing changes needs a second confirm. Each change you make is logged in this organization's Activity as Steward support." });
  }
  await run("UPDATE support_sessions SET write_enabled_at=COALESCE(write_enabled_at, NOW()) WHERE id=? AND org_id=?",
    [req.user.support.id, req.user.orgId]);
  const [org] = await query("SELECT timezone FROM orgs WHERE id=?", [req.user.orgId]);
  req.audit.entity("support session", req.user.support.id, req.user.support.name);
  req.audit.action("allowed changes");
  req.audit.summary(`Steward support turned on changes for this support session, ${S.orgClock(new Date(), org && org.timezone)}. Each change it makes is logged here.`);
  res.json({ support: { ...req.user.support, writable: true } });
}));

app.post("/support-session/end", requireAuth, supportOnly, wrap(async (req, res) => {
  await run("UPDATE support_sessions SET ended_at=COALESCE(ended_at, NOW()) WHERE id=? AND org_id=?",
    [req.user.support.id, req.user.orgId]);
  req.audit.entity("support session", req.user.support.id, req.user.support.name);
  req.audit.action("ended the support session");
  res.json({ ended: true });
}));

async function accessPayload(orgId) {
  const [o] = await query("SELECT support_access_off, support_access_changed_at, support_access_changed_by FROM orgs WHERE id=?", [orgId]);
  const [last] = await query(
    "SELECT support_name, started_at FROM support_sessions WHERE org_id=? ORDER BY started_at DESC LIMIT 1", [orgId]);
  const on = !(o && o.support_access_off === true);
  return {
    on,
    label: "Let Steward support open your account",
    description: on
      ? "When you ask for help, Steward support can open your account read-only to see what you see. Each visit is logged in your Activity, and a change needs a second confirm and is logged too."
      : "Support access is off. Steward support can't open your account. Turn it on when you want help with a screen.",
    changedAt: o ? o.support_access_changed_at : null,
    changedBy: o ? o.support_access_changed_by : null,
    lastVisit: last ? { by: last.support_name, at: last.started_at } : null,
  };
}

app.get("/support-access", requireAuth, requireAdmin, wrap(async (req, res) => {
  res.json(await accessPayload(req.user.orgId));
}));

app.put("/support-access", requireAuth, requireAdmin, wrap(async (req, res) => {
  if (req.user.support) {
    return res.status(403).json({ error: "support_access_is_theirs", message: "Only the organization's own admin turns support access on or off." });
  }
  if (typeof (req.body && req.body.on) !== "boolean") return res.status(400).json({ error: "on (boolean) required" });
  const before = await accessPayload(req.user.orgId);
  await run("UPDATE orgs SET support_access_off=?, support_access_changed_at=NOW(), support_access_changed_by=? WHERE id=?",
    [!req.body.on, req.user.userId, req.user.orgId]);
  // Off ends any support session that is open now, on its next request
  // (requireAuth reads the switch live); this closes the rows as well.
  if (!req.body.on) await run("UPDATE support_sessions SET ended_at=NOW() WHERE org_id=? AND ended_at IS NULL", [req.user.orgId]);
  req.audit.entity("org setting", req.user.orgId, "Support access");
  req.audit.before({ support_access: before.on ? "on" : "off" });
  req.audit.after({ support_access: req.body.on ? "on" : "off" });
  req.audit.action(req.body.on ? "turned on" : "turned off");
  res.json(await accessPayload(req.user.orgId));
}));
}

module.exports = { routers, mount };
