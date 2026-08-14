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

## BUILD-51b (2026-08-14) — impact photos + fallback alerting

Closes the first two worries below, same build family:

- **Impact-update photos now ride the same seam.** POST/PUT `/impact-updates`
  run every photo through `storeImpactPhotos` → assetStore (kind `impact`):
  content-photo rules (must parse or be SVG, ≤6000px per side, ANY orientation
  — the 5:1 banner rule is a header rule), same 500KB cap, and an explicit
  **4-photo cap per update** (`MAX_IMPACT_PHOTOS`). Stored `/portal-assets/`
  paths echo through edits untouched; legacy data-URI rows render unchanged
  (element-level passthrough — the client resolves either generation).
  **Pruning is reference-counted across updates**: content addressing means
  one photo can back several updates, so PUT/DELETE prune only assets no
  update of the org still references (pinned by the suite: delete update 1 →
  the shared photo survives for update 2; delete update 2 → pruned + 404).
  Migration: `scripts/migrate-build51b-impact-photos.js` (API-only re-PUT of
  the photos array, idempotent, defaults to the two prod demo orgs).
- **The zero-base64 sweep is now FULL-payload**: the suite asserts the entire
  `/account/dashboard` body (theme + photos), the portal config body, and the
  directory rows contain no `;base64,` anywhere — before and after migrating a
  planted legacy update. Portal `/me` shares `matchImpactUpdates`, so the same
  rows feed it.
- **The `[assetStore] CRITICAL` fallback is no longer silent.** The alerting
  that exists: **Sentry** (live in prod — `/health` reports `sentry: true`)
  and **/health keyword monitoring** (the UptimeRobot decision). Both are now
  wired: a failed S3 put fires `Sentry.captureException` (tagged
  `area:assetStore`, no-op where Sentry isn't initialized) AND
  `/health.themeAssets` gained `dbFallbackRows` (count of assets sitting in
  Postgres WHILE S3 is configured — every one is a failed put; `null` when S3
  isn't configured, since DB storage is then by design) plus
  `dbFallbackSinceBoot`. The count refreshes on boot and the existing 5-min
  tick. No new alerting infrastructure was added — this rides the two
  channels the product already has.

## Worry paragraph (read before relying on this)

~~Impact photos still base64~~ — closed by BUILD-51b above. ~~Nothing monitors
S3-put fallbacks~~ — closed by BUILD-51b (Sentry + `/health.themeAssets.
dbFallbackRows`); note the residual: /health surfacing only alerts if the
uptime monitor's keyword check is actually extended to watch it — the
UptimeRobot config is a human dashboard step, so until then Sentry is the only
*push* channel. Remaining from BUILD-51: S3 credential rotation is manual
(`railway bucket credentials --reset` + re-set the six `PORTAL_ASSETS_S3_*`
vars); and `GET /portal-assets/:id` still doesn't honor `If-None-Match` → 304
(cheap hardening; the ETag is already the content id). One new small worry:
`pruneImpactAssets` runs a full scan of the org's updates on every impact
write — fine at ≤50 updates/org (the read cap), worth batching if updates
ever become high-volume. And the 4-photo cap is enforced by silent truncation
(the pre-BUILD-51b contract, kept deliberately so the Settings client's
`.slice(0,4)` and the server agree) — a 5th photo is dropped, not 400'd;
if that ever surprises an org admin, flip it to a typed rejection in one line.
