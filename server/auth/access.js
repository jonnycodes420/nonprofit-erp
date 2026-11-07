// server/auth/access.js · ACCESS-1. Roles per org, the viewer, and the orgs a
// person belongs to.
//
// A person's HOME org is users.org_id, with users.role. Every further org is a
// row in org_memberships with its own role. A session is in one org at a time:
// the token's orgId. requireAuth (auth.js) asks this module for the role in
// that org on every request, so a role is never read from another org.
//
// The viewer's rule itself lives in shared/viewOnly.js, which the app reads too.
"use strict";
const { query } = require("../../db");

let VO = null;
const viewOnly = async () => (VO = VO || await import("../../shared/viewOnly.js"));

// The membership row for (user, org), live, or null.
async function membershipFor(userId, orgId) {
  if (!userId || !orgId) return null;
  const [m] = await query(
    `SELECT m.org_id, m.role FROM org_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.user_id = ? AND m.org_id = ? AND m.revoked_at IS NULL AND u.deactivated_at IS NULL`,
    [String(userId), String(orgId)]);
  return m || null;
}

// The role a person holds in one org: the home row's role, or the membership's.
// null when they are not in that org. This is the only place a role is read
// for an org; requireAdmin and every other role check go through it.
async function liveRoleIn(userId, orgId) {
  const [u] = await query("SELECT org_id, role, deactivated_at FROM users WHERE id = ?", [String(userId)]);
  if (!u || u.deactivated_at) return null;
  if (!orgId || String(u.org_id) === String(orgId)) return u.role || "staff";
  const m = await membershipFor(userId, orgId);
  return m ? m.role : null;
}

// Every org a person can be in, home first, with the role and the org's kind.
async function orgsFor(userId) {
  return query(
    `SELECT o.id, o.name, u.role, o.org_kind AS kind, COALESCE(o.is_demo_org, false) AS demo, true AS home
       FROM users u JOIN orgs o ON o.id = u.org_id WHERE u.id = ? AND u.deactivated_at IS NULL
     UNION ALL
     SELECT o.id, o.name, m.role, o.org_kind AS kind, COALESCE(o.is_demo_org, false) AS demo, false AS home
       FROM org_memberships m JOIN orgs o ON o.id = m.org_id
      WHERE m.user_id = ? AND m.revoked_at IS NULL
     ORDER BY home DESC, name ASC`,
    [String(userId), String(userId)]);
}

// A demo or test org needs no reason to open. Anything else is a customer's,
// including an org whose kind was never set: the safe answer is "a customer".
const NO_REASON_KINDS = new Set(["demo", "internal_test", "fixture"]);
function isCustomerOrg(org) {
  if (!org) return true;
  if (org.is_demo_org === true || org.demo === true) return false;
  return !NO_REASON_KINDS.has(String(org.org_kind || org.kind || ""));
}

// requireAuth's question for a viewer: refuse this request, or null.
async function viewerRefusalFor(req) {
  const V = await viewOnly();
  const path = String(req.originalUrl || req.url || "");
  let exportsOff = false;
  if (!V.isWriteMethod(req.method) && V.isExportPath(path)) {
    const [o] = await query("SELECT viewer_exports_off FROM orgs WHERE id = ?", [req.user.orgId]);
    exportsOff = !!(o && o.viewer_exports_off === true);
  }
  return V.viewerRefusal(req.method, path, { exportsOff });
}

module.exports = { viewOnly, membershipFor, liveRoleIn, orgsFor, isCustomerOrg, viewerRefusalFor, NO_REASON_KINDS };
