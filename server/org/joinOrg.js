// server/org/joinOrg.js · ACCESS-1. A person with a Steward account joins a
// second org, is listed on its Team, and can be removed from it.
//
// Her home org stays where it was (users.org_id). The new org is a row in
// org_memberships with the role the invite named. Removing her from that org
// ends the membership, never the account she has elsewhere.
"use strict";
const { newId } = require("../shared/newId");

// POST /auth/invite/accept, when the invited address already has an account.
// She must be signed in as that account: the session (requireAuth, with its
// revocation and two-step rules) proves it is her. Returns { status, body },
// or null when requireAuth has already answered.
async function signedInAs(req, res) {
  let answered = true;
  await new Promise((resolve, reject) => {
    const status = res.status.bind(res);
    res.status = code => { res.status = status; resolve(); return status(code); };
    require("../../auth").requireAuth(req, res, err => { res.status = status; if (err) return reject(err); answered = false; resolve(); });
  });
  return answered ? null : req.user;
}

async function joinWithInvite({ query, run, invite, user, req, res, signToken }) {
  if (user.deactivated_at) {
    return { status: 409, body: { error: "account_removed", message: "That account was removed, so it can't join another organization. Ask the admin to invite a different address." } };
  }
  const signInFirst = { status: 401, body: { error: "sign_in_first",
    message: `${user.email} already has a Steward account. Sign in to it, then open this invite again to add the organization.` } };
  if (!req.headers.authorization) return signInFirst;
  const me = await signedInAs(req, res);
  if (me === null) return null;   // requireAuth answered (an ended or invalid session)
  if (!me || me.support || String(me.userId) !== String(user.id)) return signInFirst;
  if (String(user.org_id) !== String(invite.org_id)) {
    await run(
      `INSERT INTO org_memberships (id, user_id, org_id, role, created_by, created_by_name)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT (user_id, org_id) DO UPDATE SET role = EXCLUDED.role, revoked_at = NULL`,
      [newId("mem"), user.id, invite.org_id, invite.role || "staff", invite.invited_by || "system:invite-accept", null]);
  }
  await run("UPDATE invites SET accepted_at = NOW() WHERE id = ?", [invite.id]);
  if (req.audit) {
    req.audit.forOrg(invite.org_id);
    req.audit.actor({ kind: "user", id: user.id, name: String(user.name || "").trim() || user.email });
    req.audit.entity("user", user.id, user.email);
    req.audit.action("joined the team");
  }
  const [org] = await query("SELECT * FROM orgs WHERE id = ?", [invite.org_id]);
  const role = invite.role || "staff";
  const { token } = await require("../../twoFactor").issueSession(
    { id: user.id, org_id: invite.org_id, email: user.email, role, is_super_admin: user.is_super_admin === true }, req, signToken);
  return { status: 201, body: { token, user: { id: user.id, email: user.email, name: user.name, role }, org: { ...org, onboarding_complete: org.onboarding_complete ?? 1 } } };
}

// Team: the people whose home is this org, then the members who joined it.
async function teamOf(query, orgId) {
  return query(
    `SELECT id, email, name, role, created_at, (mfa_enabled_at IS NOT NULL) AS mfa_enabled, mfa_must_setup,
            (role = 'admin' OR COALESCE(can_major_gifts, false)) AS can_major_gifts, false AS member
       FROM users WHERE org_id = ? AND deactivated_at IS NULL
     UNION ALL
     SELECT u.id, u.email, u.name, m.role, m.created_at, (u.mfa_enabled_at IS NOT NULL) AS mfa_enabled, u.mfa_must_setup,
            (m.role = 'admin') AS can_major_gifts, true AS member
       FROM org_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.org_id = ? AND m.revoked_at IS NULL AND u.deactivated_at IS NULL
     ORDER BY created_at ASC`, [orgId, orgId]);
}

// DELETE /users/:id for someone who is a member here, not at home here: the
// membership ends and her sessions in this org stop; her own account stays.
async function removeMembership({ query, run, orgId, userId, by }) {
  const done = await query(
    `UPDATE org_memberships SET revoked_at = NOW() WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL RETURNING role`, [orgId, userId]);
  if (!done.length) return null;
  await require("../../twoFactor").revokeSessions("user_id=? AND org_id=?", [userId, orgId], by).catch(() => {});
  await run("UPDATE donors SET assigned_to=NULL, assigned_to_name=NULL WHERE org_id=? AND assigned_to=?", [orgId, userId]);
  return done[0];
}

module.exports = { joinWithInvite, teamOf, removeMembership };
