// publicUrl.js — the ONE resolver for the canonical public app URL.
//
// Every user-facing link the server ever emits — password-reset and invite
// emails, receipts, campaign/sequence/workflow mail, unsubscribe links, the
// recurring card-update link, Stripe redirect/return URLs, giving-page share
// links — derives its base from publicAppUrl(). A donor reading a reset link
// on a random vercel.app subdomain (or the raw railway.app API host) will,
// correctly, smell phishing — so a FRONTEND_URL value pointing at a
// deployment host is REJECTED and the canonical domain used instead. The
// /unsubscribe and /recurring/update-card backend routes are reachable on the
// canonical domain via the proxy rewrites in vercel.json (root), which is what
// lets those two donor-visible links carry stewardapp.dev too.
//
// Env source: FRONTEND_URL (the pre-existing var — deliberately not a second
// one), with CORS_ORIGIN's first origin as the local-dev fallback (the scratch
// screenshot stack boots with CORS_ORIGIN=http://localhost:4173 and no
// FRONTEND_URL). http:// is upgraded to https:// except for localhost.
// Pure + JSX/Express-free so tests can assert every branch directly.

const CANONICAL_APP_URL = "https://www.stewardapp.dev";

// Hosts that must never appear in a user-facing link: platform deployment
// domains. localhost is allowed only when it came from an explicit env value
// (local dev) — never as a default.
const DEPLOYMENT_HOST_RE = /(^|\.)(vercel\.app|railway\.app|up\.railway\.app)(:\d+)?$/i;

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

// → { url, fromEnv, rejected } — `url` never has a trailing slash;
// `rejected` carries the offending env value when one was refused.
function resolvePublicAppUrl(env = process.env) {
  const candidates = [
    env.FRONTEND_URL,
    (env.CORS_ORIGIN || "").split(",")[0],
  ];
  for (const raw of candidates) {
    let v = (raw || "").trim().replace(/\/+$/, "");
    if (!v) continue;
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    const host = hostOf(v);
    if (!host) return { url: CANONICAL_APP_URL, fromEnv: false, rejected: raw.trim() };
    if (DEPLOYMENT_HOST_RE.test(host)) return { url: CANONICAL_APP_URL, fromEnv: false, rejected: raw.trim() };
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (!isLocal) v = v.replace(/^http:\/\//i, "https://");
    return { url: v, fromEnv: true, rejected: null };
  }
  return { url: CANONICAL_APP_URL, fromEnv: false, rejected: null };
}

// The convenience the link builders call. Resolved per call (not cached) so a
// test can flip env; the cost is a couple of string ops.
function publicAppUrl() {
  return resolvePublicAppUrl().url;
}

module.exports = { CANONICAL_APP_URL, resolvePublicAppUrl, publicAppUrl };
