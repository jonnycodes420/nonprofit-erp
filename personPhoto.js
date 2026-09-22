// personPhoto.js — BUILD-94 Part 1: a face on every profile.
//
// A donor photo is NOT theme imagery. The portal logo and header banner are
// public by definition (they render on the public give page), which is why
// GET /portal-assets/:id is unauthenticated and immutable-cached. A photograph
// of a person a nonprofit has a relationship with is the opposite: it is the
// most personal column on the record, and its URL must not be guessable,
// shareable past its life, or fetchable by another tenant.
//
// So the BYTES reuse the BUILD-51 asset seam (content-addressed, org-scoped
// object key, S3-or-DB driver) and the URL gets its own front door:
//
//     /person-photos/<assetId>?e=<unix-expiry>&s=<hmac>
//
// The signature covers **the owning org id**, the asset id and the expiry. The
// route recomputes it from the org id ON THE STORED ROW — never from anything
// the caller sent. That is the whole tenant guarantee in one line: to forge a
// URL for org B's photo you would need org B's org id inside an HMAC keyed by
// a secret you do not have, and presenting org A's signature against org B's
// row recomputes to a different digest and 403s. No query parameter carries an
// org, so there is nothing to tamper with (BUILD-37 B9's rule, applied to a
// GET: the trusted side names the tenant, the caller never does).
//
// Pure config/crypto — no database, no express. Testable without a server,
// following the stripeKeys.js / publicUrl.js / branding.js convention.
const crypto = require("crypto");

// 512 square. The largest place a photo renders is the profile header at 2x on
// a retina screen; every other surface is a 20–34px row mark. A square crop is
// the only honest one for a circular mark — "fit: cover" centres it rather
// than squashing a portrait into a circle.
const PHOTO_SIZE = 512;
// 10 MB of DECODED image. Phones shoot 3–5 MB, so this accepts the case every
// org actually has without accepting a 40 MB scan of a print.
const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_STR = Math.ceil(PHOTO_MAX_BYTES * 4 / 3) + 1024; // its base64 length + slack
// Twelve hours. Long enough that a signed URL minted when Home loaded still
// renders in a tab left open all day; short enough that a URL pasted into a
// group chat is dead by the next morning.
const PHOTO_URL_TTL_MS = 12 * 60 * 60 * 1000;
const PHOTO_ASSET_KIND = "person";

function photoSecret(env = process.env) {
  // Deliberately the JWT secret: the signature is an authorization token with
  // a shorter life and a narrower scope, and a second secret nobody remembers
  // to set in Railway is a second way for photos to silently 403 in
  // production. Prefixed below so a photo signature can never be replayed as
  // anything else keyed by the same secret.
  return env.JWT_SECRET || "dev-secret";
}

function photoSignature(orgId, assetId, expMs, env) {
  return crypto.createHmac("sha256", photoSecret(env))
    .update(`person-photo|${orgId}|${assetId}|${expMs}`)
    .digest("hex").slice(0, 32);
}

// The URL the client renders in an <img src>. Relative on purpose — it rides
// the same origin/proxy every other API path does.
function signPhotoUrl({ orgId, assetId, now = Date.now(), ttlMs = PHOTO_URL_TTL_MS, env } = {}) {
  if (!orgId || !assetId) return null;
  const exp = now + ttlMs;
  return `/person-photos/${assetId}?e=${exp}&s=${photoSignature(orgId, assetId, exp, env)}`;
}

// Verify a presented (e, s) against the org the STORED ROW belongs to.
// Returns { ok } or { ok:false, reason } — the caller answers 403 for both
// reasons alike, so a probe cannot tell "wrong org" from "expired".
function verifyPhotoUrl({ orgId, assetId, e, s, now = Date.now(), env } = {}) {
  const exp = Number(e);
  if (!Number.isFinite(exp) || !s || !orgId || !assetId) return { ok: false, reason: "malformed" };
  if (exp <= now) return { ok: false, reason: "expired" };
  const want = Buffer.from(photoSignature(orgId, assetId, exp, env));
  const got = Buffer.from(String(s));
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (want.length !== got.length) return { ok: false, reason: "signature" };
  if (!crypto.timingSafeEqual(want, got)) return { ok: false, reason: "signature" };
  return { ok: true, expiresAt: exp };
}

// The mark shown when there is no photo. One or two letters, never a silhouette
// — a grey stranger-shaped icon on a record is worse than nothing; initials at
// least say whose record you are on. Organisations get one letter (an
// organisation's "last name" is not a surname).
function initialsFor(name, kind) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letter = (w) => (Array.from(w).find(c => /\p{L}|\p{N}/u.test(c)) || "").toUpperCase();
  if (kind === "organization" || words.length === 1) return letter(words[0]) || "?";
  return (letter(words[0]) + letter(words[words.length - 1])) || "?";
}

// ── BUILD-37 G5 — fetching a URL somebody else's file told us to fetch ──────
// The import mapper can point at a photo URL that came out of Equal Force,
// Bloomerang or Little Green Light. That is a server making an outbound
// request to an address an uploaded spreadsheet chose, which is the textbook
// SSRF shape. The rules, and they are absolute:
//   • https only — no http, no file:, no gopher:, no data:
//   • no literal private, loopback, link-local or unique-local address
//   • no cloud metadata endpoint (169.254.169.254 and friends)
//   • no credentials in the URL, no non-standard port
// A hostname that RESOLVES into a private range is caught at fetch time by
// checking the socket's remote address (fetchRemoteImage below) — this
// function catches everything that can be decided from the string alone.
const METADATA_HOSTS = new Set([
  "169.254.169.254", "metadata.google.internal", "metadata.goog",
  "instance-data", "metadata",
]);

function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some(o => Number(o) > 255)) return true; // not a valid address at all
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||          // CGNAT 100.64/10
    (a === 169 && b === 254) ||                    // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||                      // 192.0.0/24 + 192.0.2/24
    (a === 198 && (b === 18 || b === 19)) ||       // benchmarking
    a >= 224;                                      // multicast + reserved
}
function isPrivateIPv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::1" || h === "::") return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;   // unique-local fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;   // link-local fe80::/10
  // IPv4-mapped (::ffff:169.254.169.254) inherits the IPv4 verdict.
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  return v4 ? isPrivateIPv4(v4[1]) : false;
}

// Returns { ok:true, url } or { ok:false, reason } — reason is logged per row
// and NEVER thrown: a bad photo URL on row 4,000 of a 25,000-row import must
// cost that row its photo and nothing else (the import keeps going).
function checkRemoteImageUrl(raw) {
  let u;
  try { u = new URL(String(raw || "").trim()); } catch { return { ok: false, reason: "not a URL" }; }
  if (u.protocol !== "https:") return { ok: false, reason: "not https" };
  if (u.username || u.password) return { ok: false, reason: "URL carries credentials" };
  if (u.port && u.port !== "443") return { ok: false, reason: "non-standard port" };
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, reason: "no host" };
  if (METADATA_HOSTS.has(host)) return { ok: false, reason: "metadata endpoint" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { ok: false, reason: "internal host" };
  }
  if (isPrivateIPv4(host) || isPrivateIPv6(host)) return { ok: false, reason: "private address" };
  return { ok: true, url: u.toString() };
}

const PHOTO_FETCH_TIMEOUT_MS = 10_000;

module.exports = {
  PHOTO_SIZE, PHOTO_MAX_BYTES, PHOTO_MAX_STR, PHOTO_URL_TTL_MS, PHOTO_ASSET_KIND,
  PHOTO_FETCH_TIMEOUT_MS,
  signPhotoUrl, verifyPhotoUrl, initialsFor, checkRemoteImageUrl,
  _photoSignature: photoSignature,
};
