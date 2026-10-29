// supportAccess.js · FIX-57. STEWARD SUPPORT OPENS ONE ORG, READ-ONLY.
//
// This replaces anyone ever reading production data to debug a customer's
// screen. A super-admin presses "Open as support" on one org and gets a
// session IN that org, scoped exactly like a member's (req.user.orgId is that
// org and nothing else), with these differences:
//
//   - It is READ-ONLY on the server. Every non-GET from a support session is
//     refused with one sentence (SUPPORT_READ_ONLY) until the session was
//     upgraded after a second confirm. Hiding buttons is not the guard.
//   - It is not a super-admin session: requireSuperAdmin refuses it,
//     so no /admin route, and no other org, is reachable from inside it.
//   - Every open lands in the org's Activity ("Steward support viewed your
//     account, 10:14 AM", in the org's own clock), and every change made in it
//     is filed under the support actor, never under a member of their team.
//   - The org can turn it off in Settings. Off ends any open session on its
//     next request, and the super-admin console says "Support access is off".
//   - It lives two hours at most, and the live row decides: ended, expired,
//     switched off, or the user no longer a super-admin, and it is dead.
const { query } = require("./db");

const SUPPORT_HOURS = 2;
const SUPPORT_READ_ONLY = "This is a read-only support session. Choose Allow changes in the support banner, and confirm, to make a change. Each change is logged in this organization's Activity.";
const SUPPORT_OFF = "Support access is off. The organization turned it off in Settings, so Steward support can't open it.";
const SUPPORT_ENDED = "This support session has ended.";
// What a read-only session may still POST: ending itself, the second confirm,
// and signing out.
const SUPPORT_ALWAYS = new Set(["/support-session/end", "/support-session/allow-changes", "/auth/logout"]);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// "Steward support (Jonathan)": the first name of the person behind it.
function supportName(userName, email) {
  const first = String(userName || "").trim().split(/\s+/)[0] || String(email || "").split("@")[0] || "";
  return first ? `Steward support (${first})` : "Steward support";
}

// "10:14 AM" in the org's own zone.
function orgClock(date, timeZone) {
  const fmt = tz => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(date);
  try { return fmt(timeZone || "America/New_York"); } catch { return fmt("America/New_York"); }
}

// The live state of one support session, or { dead: sentence }.
async function liveSupportSession(sid, userId) {
  const rows = await query(
    `SELECT s.id, s.org_id, s.support_name, s.write_enabled_at, s.expires_at, s.ended_at,
            o.support_access_off, u.is_super_admin
       FROM support_sessions s
       JOIN orgs o ON o.id = s.org_id
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.user_id = ?`, [sid, userId]);
  const s = rows[0];
  if (!s || s.ended_at || new Date(s.expires_at).getTime() <= Date.now()) return { dead: SUPPORT_ENDED };
  if (s.is_super_admin !== true) return { dead: SUPPORT_ENDED };
  if (s.support_access_off === true) return { dead: SUPPORT_OFF };
  return { id: s.id, orgId: s.org_id, name: s.support_name, writable: !!s.write_enabled_at, expiresAt: s.expires_at };
}

// The refusal for a request from a read-only support session, or null.
function readOnlyRefusal(req, support) {
  if (!support || support.writable) return null;
  if (!MUTATING.has(String(req.method).toUpperCase())) return null;
  const path = String(req.originalUrl || "").split("?")[0];
  if (SUPPORT_ALWAYS.has(path)) return null;
  return { error: "support_read_only", message: SUPPORT_READ_ONLY };
}

module.exports = { SUPPORT_HOURS, SUPPORT_READ_ONLY, SUPPORT_OFF, SUPPORT_ENDED, supportName, orgClock, liveSupportSession, readOnlyRefusal };
