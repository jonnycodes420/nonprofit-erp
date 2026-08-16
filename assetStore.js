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
// BUILD-56 — the id is salted by KIND too. Pre-BUILD-56 ids weren't, so
// byte-identical uploads across kinds (one SVG as both logo and impact photo)
// shared a single row whose `kind` was whichever came first — and the per-kind
// prune could then 404 the OTHER kind's live pointer, or (post-retention)
// resurrect a row outside its pruner's scope. Kind-salting removes sharing
// for new writes; the global live-reference guard in pruneUnreferencedAssets
// protects legacy shared rows. Existing stored ids keep serving unchanged (a
// re-upload of the same bytes mints a kind-salted id and the old row retires
// into the retention window).
function assetIdFor(orgId, kind, contentType, buffer) {
  return "pa_" + sha256hex(orgId + "|" + kind + "|" + contentType + "|").slice(0, 8) + sha256hex(buffer).slice(0, 16);
}
const assetPath = (id) => `/portal-assets/${id}`;

// Store a validated theme image; returns { id, path }. Content-addressed:
// identical bytes for the same org+type return the existing asset untouched.
async function putThemeAsset({ orgId, kind, buffer, contentType, width, height }) {
  const id = assetIdFor(orgId, kind, contentType, buffer);
  const existing = await query(`SELECT id, deleted_at FROM portal_assets WHERE id = ?`, [id]);
  if (existing.length) {
    // BUILD-56 — re-uploading bytes that are sitting in the retention window
    // RESURRECTS the soft-deleted object (content addressing makes this free).
    if (existing[0].deleted_at != null) {
      await run(`UPDATE portal_assets SET deleted_at = NULL WHERE id = ?`, [id]);
      refreshRetentionCounts().catch(() => {});
    }
    return { id, path: assetPath(id) };
  }
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
  // BUILD-56 — a soft-deleted object 404s like a destroyed one: a removed
  // image must disappear from the public URL; restore is the only way back.
  const [row] = await query(`SELECT * FROM portal_assets WHERE id = ? AND deleted_at IS NULL`, [id]);
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

// BUILD-56 — the retention window. Rationale (decided, don't re-litigate):
// the realistic failure is a mis-click or a bad run noticed days-to-weeks
// later; the storage cost of a few hundred images for 90 days is pennies
// against a permanent, unrecoverable loss of a customer's logo.
const ASSET_RETENTION_DAYS = 90;

// Soft-delete every stored asset of one kind for an org except the ids in
// keep — called on replace/clear (theme: keep ≤1) and after impact/campaign/
// widget writes (keep = every id still referenced). BUILD-56: this MARKS
// deleted_at and KEEPS the bytes (DB row and S3 object). Nothing here
// destroys anything — destruction happens only in the seam below, and only
// past ASSET_RETENTION_DAYS.
async function pruneUnreferencedAssets(orgId, kind, keepIds) {
  // Legacy (pre-kind-salt) rows can be SHARED across kinds; a row ANY live
  // pointer still references is never pruned, whatever its recorded kind.
  const liveRefs = await collectLiveAssetRefs(orgId);
  const keep = [...new Set([...(keepIds || []), ...liveRefs])];
  const r = await run(
    `UPDATE portal_assets SET deleted_at = NOW()
     WHERE org_id = ? AND kind = ? AND deleted_at IS NULL AND NOT (id = ANY(?))`,
    [orgId, kind, keep]);
  if (r.changes) refreshRetentionCounts().catch(() => {});
  return r.changes || 0;
}
const pruneThemeAssets = (orgId, kind, keepId) => pruneUnreferencedAssets(orgId, kind, keepId ? [keepId] : []);

// Un-delete a retained object (the restore half lives in
// scripts/restore-asset.js, which also re-points the pointer from history).
async function restoreAsset(id) {
  const [row] = await query(`SELECT id, deleted_at FROM portal_assets WHERE id = ?`, [id]);
  if (!row) return null;
  if (row.deleted_at != null) await run(`UPDATE portal_assets SET deleted_at = NULL WHERE id = ?`, [id]);
  refreshRetentionCounts().catch(() => {});
  return row;
}

// Every id currently referenced by a LIVE pointer, across every pointer
// table an asset kind is stored into (portal_settings logo/header ·
// impact_updates photos · campaigns hero · portal_pages draft+published
// widget images). The purge guard reads this — an asset on this list is
// never destroyed no matter how old its deleted_at is. Kept in ONE place on
// purpose; the asset-retention battery pins that all four tables are here.
async function collectLiveAssetRefs(orgId) {
  const refs = new Set();
  const add = (v) => { const m = /^\/portal-assets\/(pa_[a-f0-9]{24})$/.exec(String(v || "")); if (m) refs.add(m[1]); };
  const w = orgId ? ` WHERE org_id = ?` : ``;
  const p = orgId ? [orgId] : [];
  for (const r of await query(`SELECT logo_url, header_image_url FROM portal_settings${w}`, p)) { add(r.logo_url); add(r.header_image_url); }
  for (const r of await query(`SELECT photos FROM impact_updates${w}`, p)) {
    for (const ph of (Array.isArray(r.photos) ? r.photos : [])) add(ph);
  }
  for (const r of await query(`SELECT hero_image_url FROM campaigns${w}`, p)) add(r.hero_image_url);
  for (const r of await query(`SELECT draft, published FROM portal_pages${w}`, p)) {
    for (const list of [r.draft, r.published]) {
      for (const wd of (Array.isArray(list) ? list : [])) {
        add(wd.image);
        for (const u of (wd.images || [])) add(u);
        for (const m of (wd.members || [])) add(m && m.photo);
      }
    }
  }
  return refs;
}

// ── DESTRUCTION SEAM ────────────────────────────────────────────────────────
// destroyAsset() is the ONLY code path, anywhere in the product, that removes
// asset BYTES (the DB row and the S3 object). Everything else soft-deletes
// through pruneUnreferencedAssets above. The asset-retention battery fails
// the build on any destruction primitive outside this block.
async function destroyAsset(row) {
  const cfg = s3Config();
  if (row.storage === "s3" && cfg && row.s3_key) {
    await s3Delete(cfg, row.s3_key); // throws → row survives, retried next sweep
  }
  await run(`DELETE FROM portal_assets WHERE id = ?`, [row.id]);
}
// ── END DESTRUCTION SEAM ────────────────────────────────────────────────────

// BUILD-56 Part 4 — the purge sweep: destroys objects soft-deleted longer
// than ASSET_RETENTION_DAYS ago. Guards, in order:
//   • an object still referenced by a live pointer is NEVER destroyed — it is
//     restored (self-heal: a referenced-but-soft-deleted object was serving
//     404s to a live pointer, which is itself a bug) and logged CRITICAL;
//   • every destruction writes an asset_purge_log row;
//   • an S3 delete failure keeps the DB row so the next sweep retries.
async function purgeExpiredAssets({ orgId = null } = {}) {
  const rows = await query(
    `SELECT id, org_id, kind, bytes, storage, s3_key, deleted_at FROM portal_assets
     WHERE deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL '${ASSET_RETENTION_DAYS} days'
     ${orgId ? "AND org_id = ?" : ""}`,
    orgId ? [orgId] : []);
  let purged = 0, restoredReferenced = 0, failed = 0;
  if (rows.length) {
    const refs = await collectLiveAssetRefs(orgId);
    for (const r of rows) {
      if (refs.has(r.id)) {
        console.error(`[assetStore] CRITICAL: soft-deleted asset ${r.id} is still referenced by a live pointer — restoring it, never purging`);
        await run(`UPDATE portal_assets SET deleted_at = NULL WHERE id = ?`, [r.id]);
        restoredReferenced++;
        continue;
      }
      try {
        await destroyAsset(r);
        await run(
          `INSERT INTO asset_purge_log (id, asset_id, org_id, kind, bytes, storage, soft_deleted_at) VALUES (?,?,?,?,?,?,?)`,
          ["apl_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12), r.id, r.org_id, r.kind, r.bytes, r.storage, r.deleted_at]);
        purged++;
      } catch (e) {
        failed++;
        console.error(`[assetStore] purge of ${r.id} failed (row kept; retried next sweep):`, e.message);
      }
    }
    console.log(`[assetStore] purge: ${purged} destroyed past ${ASSET_RETENTION_DAYS}d retention, ${restoredReferenced} referenced→restored, ${failed} failed`);
  }
  await refreshRetentionCounts().catch(() => {});
  return { purged, restoredReferenced, failed };
}

// BUILD-51b — fallback visibility for /health. dbFallbackRows counts assets
// sitting in Postgres WHILE S3 is configured (each one is a failed S3 put);
// null when S3 isn't configured (DB storage is then by design, not a fault).
// Cached so /health stays synchronous; refreshed on boot + the 5-min tick +
// bumped live by the fallback path above.
let dbFallbackSinceBoot = 0;
let dbFallbackRows = null;
async function refreshAssetFallbackCount() {
  if (!s3Config()) { dbFallbackRows = null; return null; }
  // BUILD-56 — soft-deleted rows sit in Postgres BY DESIGN (the retention
  // window), not as failed S3 puts; they must not trip the fallback alarm.
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE storage = 'db' AND deleted_at IS NULL`);
  dbFallbackRows = r ? r.n : 0;
  return dbFallbackRows;
}
// BUILD-56 — /health surfaces how many retained objects are restorable
// (there is something to restore ⇒ someone can notice a bad overwrite).
// Cached like dbFallbackRows; bumped inline by prune/restore/purge.
let softDeletedRows = null;
async function refreshRetentionCounts() {
  const [r] = await query(`SELECT COUNT(*)::int AS n FROM portal_assets WHERE deleted_at IS NOT NULL`);
  softDeletedRows = r ? r.n : 0;
  return softDeletedRows;
}
function assetHealth() {
  return { s3: !!s3Config(), dbFallbackRows, dbFallbackSinceBoot, softDeleted: softDeletedRows };
}

module.exports = {
  s3Config, putThemeAsset, getThemeAsset, pruneThemeAssets, pruneUnreferencedAssets,
  refreshAssetFallbackCount, refreshRetentionCounts, assetHealth,
  restoreAsset, collectLiveAssetRefs, purgeExpiredAssets, ASSET_RETENTION_DAYS,
  assetIdFor, assetPath, ASSET_ID_RE,
  _signedS3Request: signedS3Request, // exported for the suite's determinism checks
};
