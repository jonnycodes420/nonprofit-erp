const jwt = require("jsonwebtoken");
const { query } = require("./db");
const { sessionCache } = require("./sessionCache");

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}
const SIGNING_SECRET = SECRET || "nonprofit_erp_secret_dev";

function signToken(payload) {
  return jwt.sign(payload, SIGNING_SECRET, { expiresIn: "7d" });
}

// Loader for the session cache: the live revocation state for one user, or null
// if the row is gone (deleted/removed → no pass-through, ever).
async function loadUserSession(userId) {
  const rows = await query("SELECT sessions_valid_after, role, org_id, deactivated_at FROM users WHERE id = ?", [userId]);
  return rows.length ? rows[0] : null;
}

// BUILD-38 Part 1 — revocation-aware auth. After verifying the (stateless, 7-day)
// JWT, revalidate against the live users row via a 30s-TTL cache: reject if the
// user is gone, or if the token was issued before the user's sessions_valid_after
// (password reset/change, role change, removal, deactivation all bump that). The
// cache keeps this off the per-request DB path — worst-case revocation lag is the
// TTL, not 7 days. requireAdmin/requireSuperAdmin (server.js) still do an UNcached
// live read (BUILD-37) — correctness beats latency on that small route set.
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "no_token", message: "No token provided" });
  }
  let payload;
  try {
    payload = jwt.verify(auth.slice(7), SIGNING_SECRET);
  } catch (err) {
    // Distinguish verify failure modes so the client can react appropriately.
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "token_expired", message: "Your session has expired" });
    }
    // JsonWebTokenError (bad signature / malformed) and anything else → invalid.
    return res.status(401).json({ error: "invalid_token", message: "Invalid or corrupted session token" });
  }
  try {
    const info = await sessionCache.get(payload.userId, loadUserSession);
    if (!info) {
      return res.status(401).json({ error: "user_not_found", message: "Your account no longer exists" });
    }
    // BUILD-75 C.3 — a removed (soft-detached) user authenticates nowhere.
    if (info.deactivated_at) {
      return res.status(401).json({ error: "account_deactivated", message: "This account has been removed from the organization" });
    }
    const validAfterSec = Math.floor(new Date(info.sessions_valid_after).getTime() / 1000);
    // iat is whole seconds; allow 1s of clock skew before rejecting.
    if (typeof payload.iat === "number" && payload.iat < validAfterSec - 1) {
      return res.status(401).json({ error: "session_revoked", message: "Your session is no longer valid — please log in again" });
    }
    // Overlay the LIVE role/org so requireAuth-derived context reflects the DB
    // within the TTL, not the (possibly stale) JWT claims.
    // SEC-1 — a token with a session id is only as alive as its session row.
    // Signing a session out (Settings, an owner, a password change) ends it on
    // its very next request. A token minted before SEC-1 has no sid and is
    // ended by sessions_valid_after, as before.
    if (payload.sid && !(await require("./twoFactor").sessionAlive(payload.sid, payload.userId))) {
      return res.status(401).json({ error: "session_revoked", message: "This session was signed out. Please sign in again." });
    }
    req.user = { ...payload, role: info.role, orgId: info.org_id };
    // BUILD-98 (switch) Part 8 — a setup-only session (an admin whose org
    // requires two-step sign-in and who has not set it up) opens the setup
    // routes and nothing else.
    if (payload.mfaSetup) {
      const p = String(req.originalUrl || "").split("?")[0];
      if (!["/me/mfa", "/me/mfa/setup", "/me/mfa/enable", "/auth/logout"].includes(p)) {
        return res.status(403).json({ error: "mfa_setup_required", message: "Set up two-step sign-in to continue." });
      }
    }
    // ── VOL-1 · THE VOLUNTEER COORDINATOR ─────────────────────────────────
    // A coordinator sees volunteers and hours and does not see giving. That
    // is a SECURITY boundary, not a UI preference, so it is decided here —
    // the one place every authenticated request passes through, reading the
    // LIVE role rather than the JWT's, so a change of role takes effect on
    // the next request rather than in up to seven days.
    //
    // AN ALLOWLIST, DELIBERATELY. A deny-list of money routes is a list
    // somebody forgets to add to, and the thing they forget is a donor's
    // giving history. This names what a coordinator MAY reach; everything
    // else is refused, including every route added after today.
    if (req.user.role === VOLUNTEER_COORDINATOR) {
      const path = String(req.originalUrl || "").split("?")[0];
      if (!coordinatorMayReach(path)) {
        return res.status(403).json({
          error: "coordinator_scope",
          message: "Your account covers volunteers and hours. Giving, grants and finance are not part of it. "
            + "An admin can change your role in Settings.",
        });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

// ── VOL-1 · WHAT A VOLUNTEER COORDINATOR MAY REACH ────────────────────────
// Everything a volunteer programme runs on, their own account, and the
// shell's own chrome. Nothing that carries a gift, a pledge, a grant, a
// balance or a donor's giving history.
//
// Matched on the path only. `/people/:id` is here because the roster opens a
// person's record; the ROUTE strips the money half of that record for this
// role (routes/volunteer*.js), so the allowlist and the payload agree.
const VOLUNTEER_COORDINATOR = "volunteer_coordinator";
const COORDINATOR_EXACT = new Set([
  "/health", "/me", "/org", "/org/welcome", "/org/welcome/seen", "/org/sample-data-status",
  "/billing/status", "/people/photos", "/auth/logout",
]);
// MATCHED ON THE FIRST PATH SEGMENT, not on a string prefix. A raw prefix
// list let `/volunteer` match `/volunteers-of-other-things`, which is the
// whole failure mode an allowlist exists to avoid: a route added tomorrow
// whose name happens to start with an allowed word would be open. The first
// segment is the thing that names the surface, so that is what is checked.
const COORDINATOR_SEGMENTS = new Set([
  "volunteer",          // the public pages and the volunteer's own page
  "volunteers",         // the legacy roster read
  "volunteer-hub",      // everything the coordinator's hub calls
  "volunteer-shifts",   // one logged shift
  "volunteer-hours",    // the hours import
  "me",                 // their own account, password and two-step
  "people",             // one person's record; the money half is stripped
]);
function coordinatorMayReach(path) {
  if (COORDINATOR_EXACT.has(path)) return true;
  const first = String(path || "").split("?")[0].split("/")[1] || "";
  return COORDINATOR_SEGMENTS.has(first);
}

function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
}

// FIX-20 Part 0: the session check for a FILE door. Same check as
// requireAuth, but a refusal is a plain 404, so a signed-out probe or another
// org cannot tell "this file exists" from "there is no such file". The org
// match itself is the route's job (it reads the org from the stored row).
function requireAuth404(req, res, next) {
  const status = res.status.bind(res);
  res.status = (code) => (code === 401 || code === 403)
    ? { json: () => status(404).json({ error: "not_found" }) }
    : status(code);
  return requireAuth(req, res, (err) => { res.status = status; next(err); });
}

module.exports = { signToken, requireAuth, requireAuth404, requireSuperAdmin, VOLUNTEER_COORDINATOR, coordinatorMayReach };
