# BUILD-51 — Theme Asset Storage — FINDINGS

Closes the BUILD-50 worry paragraph: base64 theme images (portal header image,
portal logo) no longer live in the `portal_settings` row and no longer ride any
payload. Impact-update photos were deliberately left in scope-out (see worry).

## Architecture

**The public URL is storage-agnostic:** every payload carries a content-addressed
path — `/portal-assets/pa_<24hex>` — served by `GET /portal-assets/:id` with
`Cache-Control: public, max-age=31536000, immutable` (safe because new bytes
always mint a new id; a stale image can never be served). In prod the path is
same-origin via a new vercel.json proxy rewrite, so Vercel's edge caches it.

**The bytes live behind a driver seam** (`assetStore.js`, the
stripeKeys/publicUrl module convention):

- **S3 driver** — active when `PORTAL_ASSETS_S3_{ENDPOINT,KEY,SECRET,BUCKET}`
  are set. A Railway bucket (`steward-portal-assets`, project nonprofit-erp,
  env production, region iad) was provisioned this build; credentials were
  minted and set on the backend service (deploy-deferred). Railway buckets are
  private S3-compatible stores (Tigris, `virtual-host` URL style) — the driver
  is ~80 lines of hand-rolled SigV4 over `fetch` (no AWS SDK dependency),
  **verified against the real bucket**: PUT 200 → GET byte-identical →
  DELETE 204 → 404. An S3 PUT failure falls back to DB storage with a CRITICAL
  log — an upload is never lost to an outage.
- **DB driver** — no env set (scratch stack, CI, any deploy before the bucket):
  bytes in the new `portal_assets` table. Identical URLs and behavior, zero
  infra. CI deliberately runs this driver.

**Upload path** (`PUT /portal-settings`, same request shape as before): type +
size caps as always, plus **server-side dimension validation** via `image-size`
(pure JS, no native deps): a header image must parse as an image, be landscape
(height < width — a portrait can only decapitate as a ~5:1 banner), and be
≥600px wide; 6000px per side cap on everything; SVGs skip the raster rules
(vectors scale). Rejections are typed `bad_image_dimensions` with human copy.
The Settings client echoing the stored URL on an unrelated save is a no-op
(never a re-upload, never an accidental clear); `""` clears and deletes the
asset; replaced/stale assets are pruned after the row points at the successor.

**Read sites** are one-line changes: five SQL selects became
`COALESCE(ps.*_url, ps.*_data)`, so an **unmigrated org renders byte-identically**
(legacy compat is pinned by the suite) and downstream code never changed.

**Settings** gained the **banner-shaped crop preview** (exact `1200×250`-ratio
cover crop under the header upload) so a portrait upload shows its own
decapitation before the server rejects it, plus URL-aware display/save handling.

## Migration

`scripts/migrate-build51-theme-assets.js` — **API-only** (login → GET
/portal-settings → re-PUT any `*_data` through the new route), idempotent,
defaults to the two prod demo orgs (org_creo, Harbor Music School (Demo)).
Scratch org_creo migrated as a side effect of re-running the capture scripts
(their theme PUT goes through the same route). Legacy direct-DB fixture orgs
deliberately stay unmigrated — they keep the compat path exercised.

## Verification

- `tests/theme-assets.test.js` — **41 asserts**, in `run-all.sh` + CI: upload →
  URL row with NULL data columns; serve route (content type, immutable headers,
  byte roundtrip, 404s); portal config / donor dashboard / directory payloads
  carry **zero** image base64; content addressing (same bytes no-op, new bytes
  new URL + prune + old-URL 404); clear deletes; the full validation matrix
  (portrait/square/narrow/oversized/garbage/bad-mime/size-cap rejected, SVG and
  portrait-logo accepted); legacy compat + migration-by-resave; org-salted ids;
  SigV4 request shape in both URL styles.
- `scripts/build50-capture.js` re-ran **85/85** against asset-backed themes
  (banners render from `/portal-assets` URLs); `build48-capture.js` **40/40**
  (its banner-src assertion updated to accept either generation; also fixed its
  fixture to clear drift-note interactions before deleting its donor — a
  pre-existing fragility unrelated to BUILD-51).
- Full `run-all.sh` green before push (pre-push gate re-runs it).

## Deliberate calls

1. **The public URL is the backend route, not a bucket URL.** Railway buckets
   are private (credentialed) stores; even if they weren't, coupling payload
   URLs to a storage host would make the storage choice permanent. The
   `/portal-assets` route + immutable headers gives CDN caching via the Vercel
   proxy and lets storage move without a URL change.
2. **CI/scratch run the DB driver on purpose** — the suite must not depend on
   bucket credentials, and the fallback path is exactly what a fresh
   self-hosted deploy would run.
3. **Square headers are rejected** (rule is `height >= width`), not just
   portraits — at ~5:1 a square crops as badly as a portrait.

## Worry paragraph (read before relying on this)

**Impact-update photos are still base64 in every dashboard payload** — BUILD-51
moved only the theme images the spec named (header, logo). The dashboard
returns up to 20 impact updates × up to 4 photos × ≤500KB each; that is now the
LARGEST remaining payload risk, and it's bigger than the one just fixed. The
same assetStore seam fits (impact photos are org-owned public-ish imagery);
it should be BUILD-5x work before any real org starts posting photo updates.
Second: the S3 credentials live as plain service env vars and were minted this
build — they're project-scoped to one bucket, but rotation is manual
(`railway bucket credentials --reset`) and nothing monitors for S3-put
fallbacks (grep Railway logs for `[assetStore] CRITICAL` after deploys; a
quiet fallback means assets silently accumulate in Postgres again). Third:
`GET /portal-assets/:id` streams through the backend with no per-asset rate
limiting beyond the app-wide limiter; at real scale a hot org's banner is one
Vercel-edge cache entry, so this is fine — but if the edge cache is ever
bypassed (cache-busting query strings, direct Railway hits), each image is a
DB/S3 read per request. Cheap hardening later: honor `If-None-Match` with a
304 (the ETag is already the content id).
