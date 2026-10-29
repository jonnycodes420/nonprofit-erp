const jwt = require("jsonwebtoken");
const { query } = require("./db");
const { sessionCache } = require("./sessionCache");

// SECURE-1 · THE SIGNING SECRET IS CHECKED BEFORE THE SERVER STARTS.
// It signs every session, unsubscribe, file and pass link. It used to be
// required only when NODE_ENV said "production", and otherwise fell back to a
// string that is in this repository, so a deploy without NODE_ENV would sign
// sessions anyone could forge. Now any server whose database is not on this
// machine refuses to start without a secret, or with one of the repo's own
// development strings; a short one starts with a loud warning (rotating it
// is on NEEDS-JONATHAN). Only a loopback database (a laptop, CI, the
// battery) may use the development fallback.
const PUBLIC_DEV_SECRETS = ["nonprofit_erp_secret_dev", "dev-secret", "local-test-secret", "survey-link-dev-secret"];
const MIN_SECRET_LENGTH = 32;
function jwtSecretProblem(env = process.env) {
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(String(env.DATABASE_URL || "")) && env.NODE_ENV !== "production";
  const s = env.JWT_SECRET || "";
  if (local) return null;
  if (!s) return { fatal: true, message: "JWT_SECRET is not set. Steward will not start without it." };
  if (PUBLIC_DEV_SECRETS.includes(s)) return { fatal: true, message: "JWT_SECRET is a development value from the repository. Steward will not start with it." };
  if (s.length < MIN_SECRET_LENGTH) return { fatal: false, message: `JWT_SECRET is shorter than ${MIN_SECRET_LENGTH} characters. Rotate it to a long random value.` };
  return null;
}
{
  const p = jwtSecretProblem();
  if (p && p.fatal) throw new Error(p.message);
  if (p) console.error("[security] " + p.message);
}
// SECURE-1 · a staff reset or set-password link's token is stored as its
// SHA-256, like every donor-side token, so a copy of the database (a backup,
// a leaked read) holds no live link. "h1:" marks a hashed row; a row written
// before the change is plaintext and matched as it is until it expires (seven
// days at most), and a value that itself starts "h1:" is never matched as
// plaintext, so the stored hash cannot be replayed as a token.
const RESET_HASH_PREFIX = "h1:";
function resetTokenHash(token) {
  return RESET_HASH_PREFIX + require("crypto").createHash("sha256").update(String(token)).digest("hex");
}
const RESET_TOKEN_MATCH = `(token = ? OR (token = ? AND token NOT LIKE 'h1:%'))`;
function resetTokenArgs(token) { return [resetTokenHash(token), String(token)]; }

const SECRET = process.env.JWT_SECRET;
const SIGNING_SECRET = SECRET || "nonprofit_erp_secret_dev";

function signToken(payload) {
  return jwt.sign(payload, SIGNING_SECRET, { expiresIn: "7d" });
}
// SCALE-2: a two-minute token for a recompute inside this process (the
// per-org summary's refresh and check). It is never sent anywhere.
function signInternalToken(payload) {
  return jwt.sign(payload, SIGNING_SECRET, { expiresIn: "2m" });
}

// FIX-57: a support session's token. Two hours, like the session row; the
// row (supportAccess.js) is what actually decides whether it lives.
function signSupportToken(payload) {
  return jwt.sign(payload, SIGNING_SECRET, { expiresIn: "2h" });
}

// FIX-22 · the user a request is signed in as, from its bearer token, or null.
// Used only to KEY a rate limiter (an office on one wifi must never share a
// limit): a valid signature is enough here, because requireAuth still decides
// whether the session is alive. A forged or expired token keys by IP.
function tokenUserId(req) {
  const auth = req.headers && req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  try {
    const p = jwt.verify(auth.slice(7), SIGNING_SECRET);
    return p && p.userId ? String(p.userId) : null;
  } catch { return null; }
}

// HARDEN-1 · the org a request's session is in, read the way requireAuth
// reads it (the live users row, through the same cache), or null when the
// token does not verify. middleware/orgBound.js compares it with the org the
// page was rendered for; requireAuth still decides whether the session lives.
async function sessionOrgOf(req) {
  const auth = req.headers && req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) return null;
  let p;
  try { p = jwt.verify(auth.slice(7), SIGNING_SECRET); } catch { return null; }
  if (!p || !p.userId) return null;
  // FIX-57: a support session is in the org it was opened for.
  if (p.supportSid) {
    const s = await require("./supportAccess").liveSupportSession(p.supportSid, p.userId).catch(() => null);
    return s && s.orgId ? String(s.orgId) : null;
  }
  const info = await sessionCache.get(p.userId, loadUserSession);
  return info && info.org_id ? String(info.org_id) : null;
}

// Loader for the session cache: the live revocation state for one user, or null
// if the row is gone (deleted/removed → no pass-through, ever).
async function loadUserSession(userId) {
  const rows = await query("SELECT sessions_valid_after, role, org_id, deactivated_at, name FROM users WHERE id = ?", [userId]);
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
      return res.status(401).json({ error: "session_revoked", message: "Your session is no longer valid, please log in again" });
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
    // FIX-57 · A SUPPORT SESSION is in the org it was opened for, and only
    // that one, as an admin; read-only until its second confirm
    // (supportAccess.js). The live row decides every request. isSuperAdmin
    // stays TRUE on purpose: every "a super-admin can't turn this on for
    // them" refusal (AUTO-1, SEND-GATE) still refuses support. What it does
    // NOT open is any /admin route: requireSuperAdmin refuses a support
    // session, so no other org is reachable from inside one.
    if (payload.supportSid) {
      const S = require("./supportAccess");
      const s = await S.liveSupportSession(payload.supportSid, payload.userId);
      if (s.dead) return res.status(401).json({ error: "support_session_ended", message: s.dead });
      req.user = { ...payload, role: "admin", orgId: s.orgId, isSuperAdmin: true,
                   support: { id: s.id, name: s.name, writable: s.writable } };
      const refusal = S.readOnlyRefusal(req, req.user.support);
      if (refusal) {
        if (req.audit) req.audit.skip("support_read_only");
        return res.status(403).json(refusal);
      }
      return next();
    }
    // FIX-57: her name as set, so what she does is signed with it, not her email.
    req.user = { ...payload, role: info.role, orgId: info.org_id, name: String(info.name || "").trim() || null };
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
  "support",            // SUPPORT-1: the help assistant; it reads no giving for this role
]);
function coordinatorMayReach(path) {
  if (COORDINATOR_EXACT.has(path)) return true;
  const first = String(path || "").split("?")[0].split("/")[1] || "";
  return COORDINATOR_SEGMENTS.has(first);
}

function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin || req.user.support) return res.status(403).json({ error: "Forbidden" });
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

module.exports = {
  jwtSecretProblem, resetTokenHash, RESET_TOKEN_MATCH, resetTokenArgs, signToken, signInternalToken, signSupportToken, tokenUserId, sessionOrgOf, requireAuth, requireAuth404, requireSuperAdmin, VOLUNTEER_COORDINATOR, coordinatorMayReach };
