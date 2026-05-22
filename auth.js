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
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    req.user = jwt.verify(auth.slice(7), SIGNING_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

module.exports = { signToken, requireAuth };
