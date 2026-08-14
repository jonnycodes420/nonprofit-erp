// BUILD-51 — theme-asset storage: the base64 theme images (portal header,
// portal logo) move OUT of the portal_settings row and out of every payload.
// Payloads carry a stable, content-addressed URL PATH (/portal-assets/<id>)
// served by GET /portal-assets/:id with immutable cache headers; the BYTES
// live behind this module's driver seam:
//
//   • S3 driver — when the PORTAL_ASSETS_S3_* env is set (a Railway bucket:
//     S3-compatible endpoint + key/secret; objects are PRIVATE, the backend
//     route is the public URL). Hand-rolled SigV4 over fetch — no AWS SDK
//     dependency for three verbs on one bucket.
//   • DB driver — no env set (scratch stack, CI, a fresh deploy before the
//     bucket exists): bytes live in the portal_assets table. Same URLs, same
//     behavior, zero infra. An S3 PUT failure also falls back here (loud log,
//     never a lost upload).
//
// Ids are content-addressed per org (sha256 over org+type+bytes → pa_<24hex>),
// so a re-upload of identical bytes is a no-op and any new bytes mint a NEW
// URL — immutable caching can never serve a stale image.
//
// Follows the stripeKeys.js/publicUrl.js convention: pure config resolution,
// testable without a server.
const crypto = require("crypto");
const Sentry = require("@sentry/node"); // no-op if the server never init'd it
const { query, run } = require("./db");

function s3Config(env = process.env) {
  const endpoint = env.PORTAL_ASSETS_S3_ENDPOINT;
  if (!endpoint || !env.PORTAL_ASSETS_S3_KEY || !env.PORTAL_ASSETS_S3_SECRET || !env.PORTAL_ASSETS_S3_BUCKET) return null;
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    key: env.PORTAL_ASSETS_S3_KEY,
    secret: env.PORTAL_ASSETS_S3_SECRET,
    bucket: env.PORTAL_ASSETS_S3_BUCKET,
    region: env.PORTAL_ASSETS_S3_REGION || "auto",
    // Railway buckets report urlStyle "virtual-host" (bucket in the
    // hostname); path style is the fallback for stores that prefer it.
    urlStyle: env.PORTAL_ASSETS_S3_URL_STYLE || "virtual-host",
  };
}

const sha256hex = (x) => crypto.createHash("sha256").update(x).digest("hex");
const hmac = (key, x) => crypto.createHmac("sha256", key).update(x).digest();

// Minimal AWS Signature V4 for S3 path-style requests (PUT/GET/DELETE object).
function signedS3Request(cfg, method, objectKey, body) {
  const url = cfg.urlStyle === "virtual-host"
    ? new URL(`${cfg.endpoint.replace("://", `://${cfg.bucket}.`)}/${objectKey}`)
    : new URL(`${cfg.endpoint}/${cfg.bucket}/${objectKey}`);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body || "");
  const headers = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map(h => `${h}:${headers[h]}\n`).join("");
  const canonicalRequest = [
    method, url.pathname, "", canonicalHeaders, signedHeaderNames.join(";"), payloadHash,
  ].join("\n");
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonicalRequest)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac("AWS4" + cfg.secret, dateStamp), cfg.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.key}/${scope}, SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`;
  return { url: url.toString(), headers: { ...headers, Authorization: authorization } };
}

async function s3Put(cfg, objectKey, buffer, contentType) {
  // Content-Type deliberately unsigned (kept out of SignedHeaders) — the
  // stored content type of record lives in the portal_assets row.
  const { url, headers } = signedS3Request(cfg, "PUT", objectKey, buffer);
  const r = await fetch(url, { method: "PUT", headers: { ...headers, "content-type": contentType }, body: buffer });
  if (!r.ok) throw new Error(`s3 put ${r.status}: ${(await r.text()).slice(0, 300)}`);
}
async function s3Get(cfg, objectKey) {
  const { url, headers } = signedS3Request(cfg, "GET", objectKey, "");
  const r = await fetch(url, { headers });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`s3 get ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function s3Delete(cfg, objectKey) {
  const { url, headers } = signedS3Request(cfg, "DELETE", objectKey, "");
  const r = await fetch(url, { method: "DELETE", headers });
  if (!r.ok && r.status !== 404) throw new Error(`s3 delete ${r.status}`);
}

const ASSET_ID_RE = /^pa_[a-f0-9]{24}$/;
function assetIdFor(orgId, contentType, buffer) {
  return "pa_" + sha256hex(orgId + "|" + contentType + "|").slice(0, 8) + sha256hex(buffer).slice(0, 16);
}
const assetPath = (id) => `/portal-assets/${id}`;

// Store a validated theme image; returns { id, path }. Content-addressed:
// identical bytes for the same org+type return the existing asset untouched.
async function putThemeAsset({ orgId, kind, buffer, contentType, width, height }) {
  const id = assetIdFor(orgId, contentType, buffer);
  const existing = await query(`SELECT id FROM portal_assets WHERE id = ?`, [id]);
  if (existing.length) return { id, path: assetPath(id) };
  const cfg = s3Config();
  let storage = "db", s3Key = null, data = null;
  if (cfg) {
    try {
      s3Key = `${orgId}/${kind}/${id}`;
      await s3Put(cfg, s3Key, buffer, contentType);
      storage = "s3";
    } catch (e) {
      // BUILD-51b — this fallback must never be silent: bytes quietly
      // re-accumulating in Postgres is the failure nobody notices until it's
      // large. Three alarms: CRITICAL log (Railway logs), a Sentry event
      // (prod alerting — Sentry is live there), and the /health
      // themeAssets.dbFallbackRows count (uptime-keyword checkable).
      console.error("[assetStore] CRITICAL: S3 put failed — falling back to DB storage:", e.message);
      dbFallbackSinceBoot++;
      try { Sentry.captureException(e, { tags: { area: "assetStore" }, extra: { orgId, kind, note: "S3 put failed; asset stored in Postgres" } }); } catch { /* Sentry not init'd */ }
      storage = "db"; s3Key = null;
    }
  }
  if (storage === "db") data = buffer.toString("base64");
  await run(
    `INSERT INTO portal_assets (id, org_id, kind, content_type, bytes, width, height, storage, s3_key, data)
     VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT (id) DO NOTHING`,
    [id, orgId, kind, contentType, buffer.length, width || null, height || null, storage, s3Key, data]);
  return { id, path: assetPath(id) };
}

async function getThemeAsset(id) {
  if (!ASSET_ID_RE.test(String(id || ""))) return null;
  const [row] = await query(`SELECT * FROM portal_assets WHERE id = ?`, [id]);
  if (!row) return null;
  let buffer = null;
  if (row.storage === "s3") {
    const cfg = s3Config();
    if (cfg) {
      try { buffer = await s3Get(cfg, row.s3_key); } catch (e) { console.error("[assetStore] S3 get failed:", e.message); }
    }
    if (!buffer && row.data) buffer = Buffer.from(row.data, "base64");
    if (!buffer) return null;
  } else {
    buffer = Buffer.from(row.data || "", "base64");
  }
  return { id: row.id, contentType: row.content_type, buffer };
}

// Remove every stored asset of one kind for an org except the ids in keep —
// called on replace/clear (theme: keep ≤1) and after impact-update writes
// (keep = every photo id any of the org's updates still references), so
// stale assets never pile in either store.
async function pruneUnreferencedAssets(orgId, kind, keepIds) {
  const keep = new Set(keepIds || []);
  const rows = await query(`SELECT id, storage, s3_key FROM portal_assets WHERE org_id = ? AND kind = ?`, [orgId, kind]);
  const cfg = s3Config();
  let pruned = 0;
  for (const r of rows) {
    if (keep.has(r.id)) continue;
    if (r.storage === "s3" && cfg && r.s3_key) {
      try { await s3Delete(cfg, r.s3_key); } catch (e) { console.error("[assetStore] S3 delete failed:", e.message); }
    }
    await run(`DELETE FROM portal_assets WHERE id = ?`, [r.id]);
    pruned++;
  }
  return pruned;
}
const pruneThemeAssets = (orgId, kind, keepId) => pruneUnreferencedAssets(orgId, kind, keepId ? [keepId] : []);

// BUILD-51b — fallback visibility for /health. dbFallbackRows counts assets
// sitting in Postgres WHILE S3 is configured (each one is a failed S3 put);
// null when S3 isn't configured (DB storage is then by design, not a fault).
// Cached so /health stays synchronous; refreshed on boot + the 5-min tick +
// bumped live by the fallback path above.
let dbFallbackSinceBoot = 0;
let dbFallbackRows = null;
async function refreshAssetFallbackCount() {
  if (!s3Config()) { dbFallbackRows = null; return null; }
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE storage = 'db'`);
  dbFallbackRows = r ? r.n : 0;
  return dbFallbackRows;
}
function assetHealth() {
  return { s3: !!s3Config(), dbFallbackRows, dbFallbackSinceBoot };
}

module.exports = {
  s3Config, putThemeAsset, getThemeAsset, pruneThemeAssets, pruneUnreferencedAssets,
  refreshAssetFallbackCount, assetHealth,
  assetIdFor, assetPath, ASSET_ID_RE,
  _signedS3Request: signedS3Request, // exported for the suite's determinism checks
};
