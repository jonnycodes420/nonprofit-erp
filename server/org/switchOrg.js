// server/org/switchOrg.js · ACCESS-1 item 2. THE ORG SWITCHER.
//
//   GET  /me/orgs           the orgs this person is in, with their role in each
//   POST /auth/switch-org   { orgId, reason? } → a new session, in that org
//
// A switch re-issues the session: a new session row and token for the target
// org, and the old session is signed out, so the old org's token can't be
// replayed. Every request after it reads the token's org (auth.js), and the
// role comes from that org's row (server/auth/access.js).
//
// A SUPER-ADMIN INTO A CUSTOMER'S ORG is never automatic: it needs a reason,
// the audit row lands in THAT org's Activity (Recent changes) with the reason
// in its sentence, and when she is not a member it opens a read-only support
// session (FIX-57), so the org's own "support access off" still holds.
// Demo and test orgs (org_kind demo / internal_test / fixture) need no reason.
//
// No route here writes an audit row; each improves the one auditTrail writes.
"use strict";
const express = require("express");
const A = require("../auth/access");

const routers = { r1: express.Router() };
const REASON_MIN = 8;

function mount(ctx) {
  const { query, run, requireAuth, requireAdmin, wrap, signToken } = ctx;
  const app = routers.r1;
  const TF = require("../../twoFactor");

  app.get("/me/orgs", requireAuth, wrap(async (req, res) => {
    const rows = await A.orgsFor(req.user.userId);
    const [me] = await query("SELECT is_super_admin FROM users WHERE id = ?", [req.user.userId]);
    res.json({
      current: req.user.orgId,
      orgs: rows.map(o => ({ id: o.id, name: o.name, role: o.role, home: !!o.home,
        needsReason: !!(me && me.is_super_admin === true) && !o.home && A.isCustomerOrg(o) })),
      superAdmin: !!(me && me.is_super_admin === true),
    });
  }));

  app.post("/auth/switch-org", requireAuth, wrap(async (req, res) => {
    const orgId = String((req.body && req.body.orgId) || "").trim();
    const reason = String((req.body && req.body.reason) || "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!orgId) return res.status(400).json({ error: "org_required", message: "Choose an organization to switch to." });
    if (req.user.support) {
      return res.status(403).json({ error: "in_support_session", message: "End the support session first, then switch." });
    }
    if (orgId === String(req.user.orgId)) {
      return res.status(400).json({ error: "already_here", message: "You're already in this organization." });
    }
    const [[me], [org]] = await Promise.all([
      query("SELECT id, org_id, email, name, is_super_admin FROM users WHERE id = ? AND deactivated_at IS NULL", [req.user.userId]),
      query("SELECT id, name, org_kind, is_demo_org, timezone, support_access_off FROM orgs WHERE id = ?", [orgId]),
    ]);
    // Not hers and not a super-admin's: the same answer as an org that doesn't exist.
    const notFound = () => res.status(404).json({ error: "not_found", message: "You're not a member of that organization." });
    if (!me || !org) return notFound();
    const role = await A.liveRoleIn(me.id, org.id);
    const superAdmin = me.is_super_admin === true;
    if (!role && !superAdmin) return notFound();

    const home = String(me.org_id) === String(org.id);
    const needsReason = superAdmin && !home && A.isCustomerOrg(org);
    if (needsReason && reason.length < REASON_MIN) {
      if (req.audit) req.audit.skip("reason_required");
      return res.status(400).json({ error: "reason_required",
        message: `${org.name} is a customer's organization. Say why you're opening it; the reason is shown to them in their Recent changes.` });
    }
    const who = String(me.name || "").trim() || me.email;

    // The row is the target org's, so the customer sees it.
    req.audit.forOrg(org.id);
    req.audit.entity("organization", org.id, org.name);

    if (role) {
      const { token } = await TF.issueSession({ id: me.id, org_id: org.id, email: me.email, role, is_super_admin: superAdmin }, req, signToken);
      if (req.user.sid) await TF.revokeSessions("id=?", [req.user.sid], "system:switch-org").catch(() => {});
      req.audit.action("switched into this organization");
      req.audit.summary(needsReason
        ? `${who} (Steward staff) opened this organization. Reason: ${reason}`
        : `${who} switched into this organization`, needsReason ? { reason } : {});
      const [full] = await query("SELECT * FROM orgs WHERE id = ?", [org.id]);
      return res.json({ token, user: { id: me.id, email: me.email, name: me.name, role, isSuperAdmin: superAdmin }, org: full });
    }

    // A super-admin who isn't a member: a read-only support session (FIX-57).
    if (org.support_access_off === true) {
      const S = require("../../supportAccess");
      return res.status(403).json({ error: "support_access_off", message: S.SUPPORT_OFF });
    }
    const S = require("../../supportAccess");
    const name = S.supportName(me.name, me.email);
    const sid = require("../shared/newId").newId("sup");
    const now = new Date();
    const expires = new Date(now.getTime() + S.SUPPORT_HOURS * 3600 * 1000);
    await run(`INSERT INTO support_sessions (id, org_id, user_id, support_name, created_by, created_by_name, started_at, expires_at, reason)
               VALUES (?,?,?,?,?,?,?,?,?)`, [sid, org.id, me.id, name, me.id, name, now, expires, reason || null]);
    const sentence = needsReason
      ? `Steward support (${name}) opened your account read-only, ${S.orgClock(now, org.timezone)}. Reason: ${reason}`
      : `Steward support (${name}) opened this organization read-only, ${S.orgClock(now, org.timezone)}`;
    req.audit.actor({ kind: "support", id: "support:" + me.id, name });
    req.audit.action("viewed your account");
    req.audit.summary(sentence, reason ? { reason } : {});
    const token = require("../../auth").signSupportToken({ userId: me.id, orgId: org.id, email: me.email, role: "admin", isSuperAdmin: true, supportSid: sid });
    const [full] = await query("SELECT * FROM orgs WHERE id = ?", [org.id]);
    res.json({ token, user: { id: me.id, email: me.email, name: me.name || name, role: "admin", isSuperAdmin: false,
      support: { id: sid, name, writable: false, orgName: org.name, expiresAt: expires } }, org: full, sentence });
  }));
  // Exports for view-only accounts: allowed unless an admin turns them off.
  const exportsPayload = async (orgId) => {
    const [o] = await query("SELECT viewer_exports_off FROM orgs WHERE id = ?", [orgId]);
    const on = !(o && o.viewer_exports_off === true);
    return { on, label: "Viewers can export",
      description: on ? "People with view-only access can download the lists and reports they can see."
                      : "People with view-only access can see lists and reports but can't download them." };
  };
  app.get("/org/viewer-exports", requireAuth, requireAdmin, wrap(async (req, res) => {
    res.json(await exportsPayload(req.user.orgId));
  }));
  app.put("/org/viewer-exports", requireAuth, requireAdmin, wrap(async (req, res) => {
    if (typeof (req.body && req.body.on) !== "boolean") return res.status(400).json({ error: "on (boolean) required" });
    const before = await exportsPayload(req.user.orgId);
    await run("UPDATE orgs SET viewer_exports_off = ? WHERE id = ?", [!req.body.on, req.user.orgId]);
    req.audit.entity("org setting", req.user.orgId, "Viewers can export");
    req.audit.before({ viewer_exports: before.on ? "on" : "off" });
    req.audit.after({ viewer_exports: req.body.on ? "on" : "off" });
    req.audit.action(req.body.on ? "turned on" : "turned off");
    res.json(await exportsPayload(req.user.orgId));
  }));
  return {};
}

module.exports = { routers, mount, REASON_MIN };
