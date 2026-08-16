# BUILD-56 — asset retention & undo — FINDINGS

Goal delivered: destruction of an org's uploaded branding is now
impossible-by-default rather than avoided-by-care. The app path (the one
BUILD-55 left completely unprotected) soft-deletes into a 90-day retention
window, every pointer change is history-logged, restore is proven by
byte-equality, and actual destruction happens in exactly one seam, guarded by
a battery that fails on any bypass.

## The verify-first probe (the red/green record)

`tests/asset-retention.test.js` was written to the POST-fix contract and
committed FAILING RED against the pre-BUILD-56 server (`c537a00`; raw output
in `audit/build56-verify-first-red.txt`): **13 passed / 21 failed + a crash**
at the purge section (no `deleted_at` column existed). The red run proved the
loss through the ordinary application path — no script involved — for all
four asset kinds:

- theme banner (PUT /portal-settings): replaced object's row **GONE**, bytes
  destroyed, no history anywhere of which hash was the banner;
- impact photo (PUT /impact-updates/:id): same;
- campaign hero (PUT /fundraising/campaigns/:id): same;
- widget image (PUT /portal-page/draft — the autosave path): same.

After Parts 1–4: **56 passed / 0 failed**, same file, no assertion loosened.
The battery was additionally proven by plant-and-fail: a planted
`DELETE FROM portal_assets` in server.js fails the seam property, and a
planted (well-behaved!) extra `pruneUnreferencedAssets` call fails the
classification property until classified.

## Every call site that can drop a refcount to zero (enumerated)

| Call site | Route | Seam path |
|---|---|---|
| theme logo/header replace or clear | PUT /portal-settings | pruneThemeAssets |
| impact photos replace/remove | PUT /impact-updates/:id | pruneImpactAssets |
| impact update delete | DELETE /impact-updates/:id | pruneImpactAssets |
| campaign hero replace/clear | PUT /fundraising/campaigns/:id | pruneCampaignAssets |
| campaign delete | DELETE /campaigns/:id | pruneCampaignAssets (**added this build** — a deleted campaign's hero used to linger live-but-unreachable) |
| page draft save | PUT /portal-page/draft | pruneWidgetAssets |
| page revert | POST /portal-page/revert | pruneWidgetAssets |

All seven route through `pruneUnreferencedAssets` (soft delete). The battery
pins the exact call-site counts per file for the whole mutation surface
(`putThemeAsset` ×5, the prune family, `recordAssetPointerHistory` ×11,
`purgeExpiredAssets` ×3) — an unclassified new site fails the suite with a
message naming the file. Known non-prune site (pre-existing, unchanged):
POST /portal-page/starter replaces the draft WITHOUT pruning, so a
starter-clobbered draft's images linger live (retention-safe — nothing lost;
the next draft save sweeps them; history IS recorded on the starter path now).

## A real bug found while building: cross-kind content-address collisions

Asset ids were salted by org + content-type but **not kind**. Byte-identical
uploads across kinds (theme-assets' fixture SVG used as logo AND impact photo)
shared ONE row whose `kind` was whichever came first — so a per-kind prune
could soft-delete (pre-BUILD-56: destroy) a row the OTHER kind's live pointer
still referenced, 404ing a live image; post-retention it also let
`putThemeAsset` resurrect a row outside its own pruner's scope. This predates
BUILD-56 — retention made it visible. Fixed at the root: ids are now
kind-salted (`assetIdFor(orgId, kind, contentType, buffer)`), and
`pruneUnreferencedAssets` additionally never touches a row ANY live pointer
references (`collectLiveAssetRefs`), which protects legacy shared rows that
already exist in prod. Existing stored ids keep serving unchanged; a re-upload
of identical bytes mints a kind-salted id and retires the old row into the
window.

## The dbFallback interaction (checked explicitly, as required)

- `getThemeAsset` filters `deleted_at IS NULL` — a soft-deleted object 404s
  on the public URL exactly like a destroyed one did (a removed image must
  disappear; restore is the only way back). It therefore can NOT "silently
  start serving from fallback": the fallback branch (S3-get-fails → row.data)
  only runs for live rows.
- `refreshAssetFallbackCount` (the BUILD-51b failed-S3-put alarm) excludes
  soft-deleted rows — retained-by-design bytes sitting in Postgres must not
  masquerade as S3 failures. Pinned by the suite.
- A soft-deleted row that is still REFERENCED (the inconsistent state) would
  404 a live pointer — the purge sweep self-heals it back to live (clears
  `deleted_at`, logs CRITICAL, never destroys). Tested.

## Retention mechanics

- `ASSET_RETENTION_DAYS = 90` — one named constant in assetStore.js; server
  and the restore script reference it, no scattered literals (battery-pinned).
- Purge: 6-hour tick + `POST /assets/run-purge` (requireAdmin, caller's org).
  Boundary tested both directions: 89 days survives, 91 purges,
  referenced-but-old restores (never purges), another org's rows untouched,
  second run destroys nothing. Every destruction writes `asset_purge_log`
  (asset id, kind, bytes, storage, soft_deleted_at). An S3 delete failure
  keeps the DB row so the next sweep retries — bytes are never orphaned in S3
  by a half-completed purge.
- Restore: `scripts/restore-asset.js` (GUARDED_WRITERS — `writerDbUrl`, prod
  needs `--i-know-this-is-prod`). `list <orgId>` shows restorable assets +
  pointer history; `restore <pa_id> --repoint` un-deletes and re-points
  portal_settings logo/header, campaign hero, or impact photos from history
  (portal-page widgets get bytes-only + guidance — a page's widget JSONB
  isn't reconstructible from asset paths). The suite proves byte-equality AND
  the pointer live on the public portal config after a script-driven restore.
- Legacy in-row base64 (pre-BUILD-51 rows never re-saved through the seam)
  being replaced/cleared is now RESCUED into the asset store first, so even
  those bytes land in the retention window instead of vanishing with the row
  value. History records the rescued path.
- `/health.themeAssets.softDeleted` = the restorable count (refreshed on
  boot/tick and inline by prune/restore/purge).

## Pointer history (Part 1)

`asset_pointer_history` (kept indefinitely): entity · entity_id · from → to ·
actor_user_id/email · created_at. Written at all 11 mutation sites:
portal_settings logo/header (upload/clear/replace incl. legacy rescue),
impact updates create/edit/delete, campaign hero create/replace/delete, page
draft save / publish / revert / starter. Page history stores the extracted
asset-path lists (tiny rows), not the widget JSONB. The restore script's
`--repoint` reads this table; restores themselves append history rows.

## Out-of-scope interactions (noted, not built)

- **Org deletion**: `DELETE /admin/orgs/:id`'s cascade does NOT touch
  `portal_assets`, `asset_pointer_history`, or `asset_purge_log` — deleting
  an org orphans its asset rows (live ones stay live-but-unreachable
  forever; they never soft-delete, so the purge never destroys them, and S3
  objects persist). Harmless at current scale but it is a slow leak and an
  inconsistency with the cascade's own FK-safe discipline; fold the three
  tables into the cascade in the org-deletion build (decide then whether org
  deletion should hard-destroy through the seam or retain for 90 days like
  everything else — I'd argue retain).
- **Already-pruned orphans (pre-BUILD-56 losses)**: NOT recoverable via
  storage-provider history — Tigris bucket versioning was never enabled (it
  is MANUAL-STEPS §6 now), so objects hard-deleted before this build are
  gone from both stores. The ddbef92 banner remains recovered only because
  bytes were saved during diagnosis.
- **Bucket versioning**: console steps + CLI alternative written up in
  MANUAL-STEPS.md §6 (enable versioning + 180-day noncurrent expiry). It is
  belt-and-braces on top of Parts 1–3, not a substitute.

## The two BUILD-55 leftovers

1. **Demo-org fund re-stamp — resolved as a FINDING, no data changed.** The
   brief's premise ("the webhook was dropping metadata.fund_id all along, so
   every existing gift row routes to the first unrestricted fund") was
   checked against prod READ-ONLY before touching anything, both demo orgs:
   - org_creo has exactly **one** Stripe-webhook gift in its whole history —
     `g_0c585e1d`, **$1**, 2026-07-13, a go-live-era smoke-test donation. Its
     fund intent was never stored (that's the bug) and is unrecoverable; it
     falls back to General Operating in the ledger, which is the correct
     default for an undesignated dollar.
   - Every designated demo gift (3× ff_03 NY Community Trust — Youth, 3×
     ff_04 Gala Reserve, 1× ff_01) was API-seeded WITH its fund and stamps
     correctly. The 29 undesignated gift-ledger rows route to General
     Operating by the documented fallback — not corruption.
   - Harbor Music School (Demo) has zero webhook gifts.
   So neither reseed nor backfill: a backfill would be INVENTING donor intent
   for one $1 test gift, and a reseed would churn a coherent ledger to fix
   nothing. The forward path (BUILD-55's webhook fix + this build's renewal
   fund) is what protects Brian's pilot orgs.
2. **`recurring_subscriptions.fund_id` — DONE.** Stamped (validated
   org-owned) at `checkout.session.completed`, resolved onto every renewal by
   the same renewal-attribution block that carries campaign/page (same
   ambiguity-attributes-nothing rule, now keyed on campaign|page|fund).
   Renewal gift AND its ledger stamp route to the designated fund;
   attribution-completeness grew to 75 (+5) incl. the unowned-fund-dropped
   case. This unblocks BUILD-53's staff-side recurring.

## Test/deploy state

- `tests/asset-retention.test.js` 56 — in run-all (88 suites).
- theme-assets updated to the retention contract (59), attribution 75 (+5),
  script-guards 285 (restore-asset classified GUARDED_WRITERS).
- Full battery green locally (87 suites, incl. the browser suites with the
  CORS_ORIGIN/PLAYWRIGHT_DIR env). CI run 31953231486 green on `6b9f1ac`.
- SHA-verified live 2026-08-16: backend `/health.buildSha` = `6b9f1acb…526f`,
  frontend `<meta name="build-sha">` = same; prod `/health.themeAssets` now
  reads `{s3: true, dbFallbackRows: 0, dbFallbackSinceBoot: 0, softDeleted: 0}`
  — softDeleted 0 is correct (nothing has been replaced since the deploy;
  the first theme replacement will make it 1, restorable for 90 days).

## §worry — what I would not bet on

1. **The purge's reference collector is a second implementation of "what
   points at assets."** `collectLiveAssetRefs` (assetStore) and the per-kind
   prune helpers (server.js) both encode the pointer tables. The battery pins
   that the collector reads all four tables and that new `putThemeAsset`
   call sites get classified — but a future FIFTH pointer table added with
   its own prune helper AND a collector update forgotten would let the purge
   destroy referenced objects of that new kind 90 days later. The
   self-heal + CRITICAL log is the backstop; a structural unification (one
   declarative pointer-table registry both sides read) would be better.
2. **Restore is script-only and history-shaped.** `--repoint` re-points the
   LAST pointer that referenced the asset. If the entity has since been
   repointed twice more, restore overwrites the current value (it records
   history, so it's undoable, but an operator moving fast can ping-pong).
   Fine for the incident class it's built for; not a general time machine.
3. **The 6-hour purge tick runs in every prod process.** Single-instance
   Railway today, so no concurrent-purge race; two instances would both
   sweep. destroyAsset + the purge-log insert aren't transactional, so a
   crash between them loses the log row (not the guard). Worth an advisory
   lock if the service ever scales out.
4. **Soft-deleted rows hold base64 in Postgres for 90 days** (DB-driver rows
   and S3-fallback rows). At demo scale that's KB; at a few hundred orgs ×
   a few images it's still small, but the retention window makes
   `portal_assets` strictly append-heavier than before — watch table size on
   /health if uploads spike (dbFallbackRows alarm still covers the live-row
   S3-failure case).
5. **Kind-salting changes ids for new uploads only.** Legacy shared-row
   collisions remain possible in prod data until each asset is next
   re-saved; the global live-ref guard in prune covers them, but that guard
   costs 4 queries per prune. Cheap at admin-write frequency; don't move
   pruning onto a hot path without revisiting.
6. **The demo-org fund conclusion rests on prod's CURRENT rows.** If a
   fund-designated live donation was made and later deleted/refunded, no
   trace would remain in what I read. The webhook-era window (pre-BUILD-55)
   and the single-$1-gift evidence make material loss very unlikely, but
   "no damage" here means "none observable", not "provably none ever".
