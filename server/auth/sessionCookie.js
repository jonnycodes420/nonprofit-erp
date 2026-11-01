// server/auth/sessionCookie.js · SECURE-3 item 1. THE STAFF SESSION MOVES TO AN httpOnly COOKIE.
//
// The session is a JWT the browser keeps in localStorage (`npe_token`) and
// sends as `Authorization: Bearer`. Any script on the page can read it and take
// the account. This moves it where no script can see it:
//
//   - Every response that hands out a staff session token (sign-in, two-step,
//     sign-up, invite accept, password change, sign out others, support open)
//     also sets it as `steward_session` (or `steward_support` for a support
//     session): HttpOnly, Secure, SameSite=Lax, Path=/.
//   - TWO RELEASES, so nobody is signed out (docs/security/cookie-plan.md).
//     Release A (SECURE-3, this file): the cookie is set AND the token is still
//     in the body; the server accepts either. The client still sends Bearer.
//     Release B (a later brief, at least seven days after the app's API URL is
//     api.stewardapp.dev, so every live session has its cookie): the client
//     stops reading npe_token and a browser's answer no longer carries it.
//   - `readCookieSession` runs above every router: a request with no
//     Authorization header but a session cookie is treated as if it had sent
//     that token as Bearer, so requireAuth, the org binding, the rate-limit
//     key and the in-process self-calls all keep one code path.
//     `req.sessionViaCookie` says it came from the cookie.
//   - CSRF. A cookie is sent by the browser on its own, so a write made with
//     the cookie must also carry (a) `X-Steward-Org` — a custom header a
//     cross-site form or image can't send, and which middleware/orgBound.js
//     checks against the session's org — and (b) `X-Steward-CSRF`, a per-session
//     token (an HMAC of the session id), checked in requireAuth. The token is
//     not a secret from our own page: it comes back on every authenticated
//     response as the `X-Steward-CSRF` header. Another site can neither read
//     that header (CORS) nor send either header (no preflight passes our list).
//   - A session cookie that no longer verifies is cleared on the 401.
//
// The support session has its own cookie so the super-admin's own session is
// still there when support ends: the support cookie wins while it is set, and
// ending support (or its 401) clears only that one.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const SESSION_COOKIE = "steward_session";
const SUPPORT_COOKIE = "steward_support";
const CSRF_HEADER = "x-steward-csrf";
const SESSION_MAX_AGE = 7 * 24 * 3600;     // matches signToken's 7d
const SUPPORT_MAX_AGE = 2 * 3600;          // matches signSupportToken's 2h
// Paths a cookie session may write to without the two CSRF headers: signing
// out (a stale tab may always end the session it holds; SameSite already stops
// a cross-site one, and the worst it could do is sign someone out).
const CSRF_EXEMPT = new Set(["/auth/logout"]);

const secret = () => process.env.JWT_SECRET || "nonprofit_erp_secret_dev";

function parseCookies(req) {
  const out = {};
  const raw = req && req.headers && req.headers.cookie;
  if (!raw) return out;
  for (const part of String(raw).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function cookieLine(name, value, maxAge) {
  return [`${name}=${value ? encodeURIComponent(value) : ""}`, "HttpOnly", "Secure", "SameSite=Lax", "Path=/",
    `Max-Age=${value ? maxAge : 0}`].join("; ");
}
function clearSessionCookies(res, { supportOnly = false } = {}) {
  if (!supportOnly) res.append("Set-Cookie", cookieLine(SESSION_COOKIE, "", 0));
  res.append("Set-Cookie", cookieLine(SUPPORT_COOKIE, "", 0));
}

// The per-session CSRF token. Bound to the session row (sid / supportSid), so
// a new sign-in, in this tab or another, has a new one; a pre-SEC-1 token with
// no sid is bound to its user and issue time.
function csrfFor(payload) {
  if (!payload) return null;
  const basis = payload.supportSid ? "sup:" + payload.supportSid
    : payload.sid ? "sid:" + payload.sid : `u:${payload.userId}:${payload.iat}`;
  return crypto.createHmac("sha256", secret()).update("steward-csrf:" + basis).digest("base64url").slice(0, 43);
}
function csrfMatches(given, payload) {
  const want = csrfFor(payload);
  const g = String(given || "");
  if (!want || g.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(g), Buffer.from(want));
}

// A staff session token (one signToken / signSupportToken made), or null.
function staffSessionPayload(token) {
  if (typeof token !== "string" || token.split(".").length !== 3) return null;
  try {
    const p = jwt.verify(token, secret());
    return p && p.userId && (p.orgId || p.supportSid) ? p : null;
  } catch { return null; }
}

// Above every router: the cookie stands in for the Bearer header.
function readCookieSession() {
  return (req, _res, next) => {
    if (req.headers.authorization) return next();
    const c = parseCookies(req);
    const token = c[SUPPORT_COOKIE] || c[SESSION_COOKIE];
    if (!token) return next();
    req.sessionViaCookie = c[SUPPORT_COOKIE] ? "support" : "session";
    req.headers.authorization = "Bearer " + token;
    next();
  };
}

// Above every router: any JSON answer that hands out a staff session token
// sets the cookie, adds the CSRF token, and (to a browser) drops the token.
function deliverSessionCookie() {
  return (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      try {
        if (body && typeof body === "object" && !Array.isArray(body) && typeof body.token === "string" && res.statusCode < 400) {
          const p = staffSessionPayload(body.token);
          if (p) {
            if (p.supportSid) res.append("Set-Cookie", cookieLine(SUPPORT_COOKIE, body.token, SUPPORT_MAX_AGE));
            else if (req.sessionViaCookie !== "support") {
              res.append("Set-Cookie", cookieLine(SESSION_COOKIE, body.token, SESSION_MAX_AGE));
              // a fresh sign-in is never inside someone else's support session
              if (!req.sessionViaCookie) res.append("Set-Cookie", cookieLine(SUPPORT_COOKIE, "", 0));
            }
            const csrf = csrfFor(p);
            res.setHeader("X-Steward-CSRF", csrf);
            // Release A: the token stays in the body too, so today's client
            // (Bearer from localStorage) is unchanged. Release B drops it for
            // browsers (docs/security/cookie-plan.md).
            body = { ...body, csrfToken: csrf };
          }
        }
      } catch { /* never fails a response */ }
      return json(body);
    };
    next();
  };
}

// Called by requireAuth once the token has verified. Returns a refusal body,
// or null. Also hands the page its CSRF token on every authenticated answer.
function cookieWriteRefusal(req, res, payload) {
  if (!req.sessionViaCookie) return null;
  try { res.setHeader("X-Steward-CSRF", csrfFor(payload)); } catch { /* headers sent */ }
  const m = req.method;
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return null;
  const path = String(req.originalUrl || "").split("?")[0];
  if (CSRF_EXEMPT.has(path)) return null;
  if (!req.headers["x-steward-org"]) {
    return { error: "csrf_header_missing", message: "This change didn't come from a Steward page. Reload the page and try again." };
  }
  if (!csrfMatches(req.headers[CSRF_HEADER], payload)) {
    return { error: "csrf_token_invalid", message: "This page's sign-in has changed. Reload the page and try again." };
  }
  return null;
}

module.exports = {
  SESSION_COOKIE, SUPPORT_COOKIE, CSRF_HEADER, parseCookies, cookieLine, clearSessionCookies,
  csrfFor, csrfMatches, staffSessionPayload, readCookieSession, deliverSessionCookie, cookieWriteRefusal,
};
