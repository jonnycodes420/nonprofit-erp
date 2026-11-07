// server/org/invites.js · WALKB-2 item 1. AN INVITE YOU CAN SEE.
//
// Muse's Walk B: a Staff invite was made and never appeared in Settings →
// Team, even after a reload. Only the Audit log showed it, because the Team
// list read `users` and nothing read `invites`. A second invite to the same
// address went through as well. Now:
//   GET    /org/invites              the pending invites (not accepted, not withdrawn)
//   POST   /org/invites/:id/resend   seven more days, and the email again
//   DELETE /org/invites/:id          Revoke: the link stops working at once
// and POST /auth/invite (routes/billing.js) refuses an address that already
// has a pending invite or is a member, through `inviteRefusal` below.
"use strict";
const express = require("express");

const routers = { r1: express.Router() };
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// A pending invite: not accepted, not withdrawn. An expired one is still
// listed (it can be resent); the seat count reads only the unexpired.
const PENDING = "i.accepted_at IS NULL AND i.revoked_at IS NULL";

// Why an invite to `email` is refused in this org, or null. One sentence each.
async function inviteRefusal(query, orgId, email) {
  const e = String(email || "").trim().toLowerCase();
  const [u] = await query("SELECT org_id, (deactivated_at IS NOT NULL) AS gone FROM users WHERE lower(email) = lower(btrim(?)) ORDER BY deactivated_at NULLS FIRST LIMIT 1", [e]);
  if (u && u.org_id === orgId) return u.gone
    ? { error: "already_user", message: `${e} was removed from your team, and that account can't be invited again.` }
    : { error: "already_member", message: `${e} is already on your team.` };
  // ACCESS-1: an account in another org can be invited; accepting adds this org
  // to it (org_memberships). A removed account, or one already a member, can't.
  if (u && u.gone) return { error: "already_user", message: `${e} already has a Steward account with another organization, so it can't be invited here.` };
  if (u) {
    const [m] = await query(`SELECT 1 FROM org_memberships m JOIN users x ON x.id = m.user_id
                              WHERE lower(x.email) = lower(btrim(?)) AND m.org_id = ? AND m.revoked_at IS NULL`, [e, orgId]);
    if (m) return { error: "already_member", message: `${e} is already on your team.` };
  }
  const [p] = await query(`SELECT i.id FROM invites i WHERE i.org_id = ? AND lower(i.email) = ? AND ${PENDING} AND i.expires_at > NOW()`, [orgId, e]);
  if (p) return { error: "already_invited", message: `${e} already has an invite waiting. Resend it from Team, under Invited.`, inviteId: p.id };
  return null;
}

// The staff invitation email, from Invite and from Resend. Staff mail, never
// donor mail: it goes through the client's mail block like every send.
async function sendStaffInvite({ resend, orgName, email, role, link }) {
  if (!process.env.RESEND_API_KEY || !resend) return false;
  try {
    const from = process.env.DEMO_SMTP_FROM || "onboarding@resend.dev";
    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: `You've been invited to join ${orgName} on Steward`,
      html: `<p>You've been invited to join <strong>${orgName}</strong> on Steward as a <strong>${role}</strong>.</p>
             <p><a href="${link}" style="background:#c9a84c;color:#0f1a12;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:16px 0">Accept Invitation</a></p>
             <p>This link expires in 7 days.</p>`,
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (err) {
    console.error("Invite email send failed:", err.message);
    return false;
  }
}

function mount(ctx) {
  const { query, run, requireAuth, requireAdmin, wrap, resend, publicAppUrl, displayNameCase } = ctx;
  const app = routers.r1;
  const linkOf = token => `${publicAppUrl()}/invite/${token}`;

  app.get("/org/invites", requireAuth, requireAdmin, wrap(async (req, res) => {
    const rows = await query(
      `SELECT i.id, i.email, i.role, i.created_at, i.expires_at, i.token, (i.expires_at <= NOW()) AS expired, u.name AS invited_by_name
         FROM invites i LEFT JOIN users u ON u.id = i.invited_by AND u.org_id = i.org_id
        WHERE i.org_id = ? AND ${PENDING}
          AND NOT EXISTS (SELECT 1 FROM users m WHERE lower(m.email) = lower(i.email) AND m.org_id = i.org_id AND m.deactivated_at IS NULL)
        ORDER BY i.created_at DESC, i.id`, [req.user.orgId]);
    res.json({ invites: rows.map(r => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at,
      expired: !!r.expired, invitedBy: r.invited_by_name || null, link: linkOf(r.token) })) });
  }));

  app.post("/org/invites/:id/resend", requireAuth, requireAdmin, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const [i] = await query(`SELECT i.id, i.email, i.role, i.token FROM invites i WHERE i.id = ? AND i.org_id = ? AND ${PENDING}`, [req.params.id, orgId]);
    if (!i) return res.status(404).json({ error: "not_found", message: "That invite is no longer waiting." });
    await run("UPDATE invites SET expires_at = ? WHERE id = ? AND org_id = ?", [new Date(Date.now() + WEEK_MS).toISOString(), i.id, orgId]);
    const [org] = await query("SELECT name FROM orgs WHERE id = ?", [orgId]);
    const emailSent = await sendStaffInvite({ resend, orgName: displayNameCase(org && org.name), email: i.email, role: i.role, link: linkOf(i.token) });
    req.audit && req.audit.entity && req.audit.entity("invite", i.id);
    res.json({ ok: true, emailSent, link: linkOf(i.token),
      message: emailSent ? `Sent again to ${i.email}. The link works for 7 more days.` : `The link works for 7 more days. Copy it and send it to ${i.email}.` });
  }));

  app.delete("/org/invites/:id", requireAuth, requireAdmin, wrap(async (req, res) => {
    const orgId = req.user.orgId;
    const done = await query(`UPDATE invites i SET revoked_at = NOW(), expires_at = LEAST(i.expires_at, NOW())
                               WHERE i.id = ? AND i.org_id = ? AND ${PENDING} RETURNING i.id, i.email`, [req.params.id, orgId]);
    if (!done.length) return res.status(404).json({ error: "not_found", message: "That invite is no longer waiting." });
    req.audit && req.audit.entity && req.audit.entity("invite", done[0].id);
    res.json({ ok: true, message: `The invite to ${done[0].email} is withdrawn. Its link no longer works.` });
  }));
  return {};
}

module.exports = { routers, mount, inviteRefusal, sendStaffInvite, PENDING };
