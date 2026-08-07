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
  const rows = await query("SELECT sessions_valid_after, role, org_id FROM users WHERE id = ?", [userId]);
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
    const validAfterSec = Math.floor(new Date(info.sessions_valid_after).getTime() / 1000);
    // iat is whole seconds; allow 1s of clock skew before rejecting.
    if (typeof payload.iat === "number" && payload.iat < validAfterSec - 1) {
      return res.status(401).json({ error: "session_revoked", message: "Your session is no longer valid — please log in again" });
    }
    // Overlay the LIVE role/org so requireAuth-derived context reflects the DB
    // within the TTL, not the (possibly stale) JWT claims.
    req.user = { ...payload, role: info.role, orgId: info.org_id };
    next();
  } catch (err) {
    next(err);
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
}

module.exports = { signToken, requireAuth, requireSuperAdmin };
