const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET;
if (!SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET environment variable is required in production");
}
const SIGNING_SECRET = SECRET || "nonprofit_erp_secret_dev";

function signToken(payload) {
  return jwt.sign(payload, SIGNING_SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "no_token", message: "No token provided" });
  }
  try {
    req.user = jwt.verify(auth.slice(7), SIGNING_SECRET);
    next();
  } catch (err) {
    // Distinguish verify failure modes so the client can react appropriately.
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "token_expired", message: "Your session has expired" });
    }
    // JsonWebTokenError (bad signature / malformed) and anything else → invalid.
    return res.status(401).json({ error: "invalid_token", message: "Invalid or corrupted session token" });
  }
}

function requireSuperAdmin(req, res, next) {
  if (!req.user?.isSuperAdmin) return res.status(403).json({ error: "Forbidden" });
  next();
}

module.exports = { signToken, requireAuth, requireSuperAdmin };
