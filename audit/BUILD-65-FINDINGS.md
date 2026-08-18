# BUILD-65 — what the storage migration left behind

BUILD-51/51b moved theme + impact assets from base64-in-the-payload to
content-addressed object storage. The migration worked; the constraints written
for the old world were still in force and failing exactly where a real
organization touches first. This build fixes the ones that were breaking for
every future customer while working fine for the legacy demo data — the tell of
a base64-era assumption left standing.

**Verify-first:** `audit/build65-verify-first-red.txt` — the tests written to the
post-fix contract, committed failing (19 + 6 red) before any implementation.
Nothing was loosened to green them.

**Status:** Parts 1, 2, 5, 6, 7 shipped + green. Part 4 re-verified (below).
Part 3 (crop on the remaining slots) is **deferred this pass** with rationale
below. Full battery green locally (see "Verification"). **Not pushed** — Part 7
changes a live-money webhook path, so the autonomous deploy is the correct
checkpoint: `BLOCKED-build65-deploy.md`.

---

## PART 1 — uploads should not make anyone think about bytes

**Why the 350KB cap existed (confirmed hypothesis: vestigial from the base64
era).** `validPortalImage(dataUri, 500000)` capped the base64 STRING at 500,000
chars (~350KB of image). It made sense only when the image *was* the stored
value — base64 in a `portal_settings` column, echoed in every payload. Since
BUILD-51 the bytes live behind the asset seam and only a `/portal-assets/<id>`
URL rides payloads, so the cap protects nothing and stops every real photo. A
phone photo is 3–5MB; it failed with "keep it under 350KB" — an instruction a
nonprofit staffer cannot act on.

**Two walls, both moved.** The 350KB `validPortalImage` cap was the *second*
wall. The *first* was the global **5mb express.json body cap** — a 4MB JPEG is
~5.5MB of base64, rejected by the body parser before any friendly logic ran (a
generic 413/500). Both are fixed:

- **Body cap:** the image-upload routes (`/portal-settings`, `/portal-page`,
  `/impact-updates`, `/fundraising/campaigns`) now carry a **22mb** body cap
  (a ~15MB image ≈ 20MB base64 + JSON). The global 5mb cap still guards every
  other route.
- **Accept + resize on ingest:** `normalizeUploadImage(kind, ct, buf)` (sharp,
  already in the stack from BUILD-61's `?w=` route) resizes the long edge down
  to the slot's real need and re-encodes — **WebP q82 for photos, PNG for
  logos** (crisp edges + transparency). SVG/GIF pass through (vector /
  possibly-animated). Long-edge caps: header/campaign/widget 2560, impact 2000,
  logo 1200. EXIF orientation honored. The `?w=` route still serves smaller
  responsive variants on demand (each cached once) — see the scope note in
  §worry.
- **Reject only non-images and absurd files, actionably.** `uploadImageError`
  returns words, not bytes: *"That file isn't an image we can use. Please upload
  a PNG, JPEG, GIF, WebP, or SVG image."* / *"That image is unusually large.
  Please use a photo under 15 MB — a normal photo from a phone or camera is well
  within that."* The pixel-dimension guard rose 6000→**12000** per side (a
  decompression-bomb guard, not a size limit — we resize now).
- **Every slot**, not just the one that surfaced it: banner, logo, campaign
  hero, impact photo, widget image — one shared helper at every ingest site.

**Pinned:** `tests/build65.test.js` uploads a **real ~4MB camera JPEG**
(4000×3000 noise) through the real path on **every slot** and asserts success,
that it stored as an asset URL, that the stored master is smaller than the
original (resized) and ≤2560px wide, and that a non-image is rejected with text
carrying no "350KB". `tests/theme-assets.test.js` updated to the new contract
(15MB accept, 12000px absurd-cap).

---

## PART 2 — the PDF logo, and everything else still assuming base64

**The PDF logo.** `renderReceiptPdf` embeds only PNG/JPEG bytes (pdfkit's
limit). `resolveOrgBrandTheme.logoDataUri` is base64-only, so a modern org —
whose logo is `portal_settings.logo_url = /portal-assets/<id>` — resolved to
`null` and **every real org's tax receipt rendered with no logo**, while the
legacy demo data (base64 in the row) worked fine. Fixed with **`resolvePdfLogo`**:
fetch the asset bytes from object storage and return a PNG/JPEG data URI,
converting WebP/SVG/GIF → PNG. As a bonus it fixes legacy base64 **WebP/GIF/SVG**
logos the old `png|jpeg`-only check silently dropped. Called only on the
low-frequency PDF-issue paths, so `resolveOrgBrandTheme` stays cheap for the hot
email paths.

### The full base64-assumption sweep (report of everything looked at)

| Site | Assumed base64? | Legacy demo worked / real org failed? | Action |
|---|---|---|---|
| `renderReceiptPdf` logo — gift receipt (`issueGiftReceipt` snapshot) | **Yes** — `orgLogo: brand.logoDataUri` | Yes — headline instance | **Fixed** → `resolvePdfLogo` |
| `renderReceiptPdf` logo — year-end statement snapshot | **Yes** — same | Yes | **Fixed** → `resolvePdfLogo` |
| `GET /receipts/preview` (Settings receipt preview) | **Yes** — `orgLogo: org.logo_data` **and** `orgAccent: org.brand_accent`/`brand_accent_fg` | Yes — modern org's Settings preview showed **no logo + Steward-green band** (a BUILD-64-class brand+logo leak; also a Part 4 finding) | **Fixed** → `resolveOrgBrandTheme` + `resolvePdfLogo` |
| `brandEmailHeaderHtml` (all 14 branded emails) | No — already falls back to `logoAbsUrl` (the asset URL as an `<img src>`) | — | No change (correct) |
| Donor impact-summary PDF (`GET /donors/:id/impact-summary/pdf`) | No — reads `resolveOrgBrandTheme.displayName`/band; embeds **no** logo image | — | No change (correct) |
| Board report PDF | Staff-facing (not a donor artifact); no logo embed | — | Out of scope |
| Dashboard / directory / give / account payloads (`COALESCE(ps.logo_url, ps.logo_data)`) | No — prefer the asset URL; client renders URL or base64 | — | No change (correct) |
| `orgs.logo_data` (legacy BUILD-13 app-UI branding) via `PUT /orgs/branding` | base64-only, 350KB-capped — but this is the LEGACY in-app sidebar/greeting mark, superseded by `portal_settings` for all donor artifacts | Not a donor-artifact regression | Left as-is; noted in §worry |

**Two instances found by accident (the PDF logo + BUILD-64's "(Demo)" leak) were
a class; looking found a third** (the preview) — exactly the asymmetry the brief
predicted. All three are the same root: a donor document/preview read a base64
DB column instead of the object-storage asset. All fixed through one resolver.

---

## PART 5 — the account CTA leaves the PDF

"Create your free giving account" stays in the receipt/year-end cover **email**
(`sendReceiptEmail` → `givingAccountEmailFooterHtml`, in the org's palette). It
is **removed from the PDF** — a document handed to an accountant or attached to a
filing is the one place a marketing link stops it looking like a receipt.
`issueYearEndStatement` no longer stamps `snapshot.givingAccountUrl`; the
`renderReceiptPdf` footer is the legal tax line only. Pinned assertions updated
(`tests/donor-front-door.test.js`): the EMAIL CTA is still asserted; the PDF
snapshot + renderer are asserted to carry none.

---

## PART 6 — `guardsOk`

`/health.guardsOk` is `true` **only when every guard is both clean AND fresh**:
reconciliation checked within ~40 min with `unrecordedCharges`/`orphanGifts`/
`accountsErrored` all zero **and not null**; `webhookSubscriptions.checked` true
and `missingCount` zero; `ledger.chartSelfHeals`, `themeAssets.dbFallbackRows`
(null = S3-unconfigured = OK), and `notifications.failedPending` all zero.

**Counters are null when unchecked.** `reconciliation.unrecordedCharges` /
`orphanGifts` now initialize to **null**, becoming numbers only after a sweep —
so right after a deploy a `0` no longer means "I didn't look" (the exact failure
`accountsErrored` was added to prevent, previously left open one door down).

**The denominator is surfaced.** `reconciliation.accountsWithStripe` = the count
of orgs with a non-null `stripe_account_id` (cached, refreshed on boot + each
sweep + the 5-min tick), so a stuck `accountsChecked: 1` when it should read 6
looks wrong instead of looking fine. Pinned by `tests/build65.test.js`.

---

## PART 7 — the won dispute

`charge.dispute.funds_reinstated` was subscribed with no handler, so a dispute
resolved in the org's favor **after** an earlier loss left the gift reversed, the
ledger short, and the donor's history wrong — permanently. Now the full
lifecycle is handled:

- **Won (never reversed):** `funds_reinstated` marks the live gift `won` +
  records the outcome.
- **Lost:** unchanged (reverse like a full refund) — but now it first writes a
  `dispute_reversals` snapshot (the gift row + the voided receipt id, keyed on
  the payment_intent).
- **Withdrawn-then-reinstated (lost → won on appeal):** `funds_reinstated`
  restores from that snapshot — re-inserts the gift verbatim, re-stamps the
  ledger through the ONE `ensureOrgLedger` helper, un-voids + re-links the
  receipt, reopens the pledge link, recalcs the donor, and consumes the
  snapshot. Idempotent (a redelivery finds the gift present and no-ops).

`stripeEvents.js` manifest updated (`webhook-manifest` re-pinned). Pinned by
`tests/stripe-disputes.test.js` §5, driven by the recorded real dispute payload
(won / lost / withdrawn-then-reinstated / redelivery). New table
`dispute_reversals` (db.js).

**`charge.dispute.funds_withdrawn` is deliberately still unhandled** — BUILD-58
chose to HOLD (not reverse) while a dispute is open; the money is only
definitively gone on a `closed`/`lost`. Reversing on `funds_withdrawn` would
undo that decision. Noted in §worry.

---

## PART 4 — re-verify BUILD-58/60 fixes against all 17 artifacts

The 17 donor-facing artifacts are enumerated in `audit/BUILD-64-FINDINGS.md`
(14 org-branded emails + 3 PDFs). Re-checked the BUILD-58/60 fixes against them:

- **Brand color / white-label logo / display name:** the enumerated batteries
  are green — `giving-flow-brand` (drives the real receipt route, scans real
  email bytes + the frozen PDF snapshot per themed/unthemed org, and fails on an
  unasserted medium), `giving-summary`, `mail-suppression`. A source grep for
  donor-facing subjects using raw `org.name` (the "(Demo)" leak class) is clean —
  every sender uses `displayNameCase`/`donorFacingOrgName`/`dfName`.
- **The one more, found by looking (as the brief expected):** the **receipt
  preview** (`GET /receipts/preview`) — the Settings surface that renders the
  SAME receipt PDF a donor gets — still read `org.brand_accent` (unset on real
  orgs → **Steward green**) and `org.logo_data` (base64-only → no logo). BUILD-64
  fixed the *issued* receipt but the *preview*, sharing the renderer, kept the
  old reads. This is precisely the surface-scoped-fix pattern BUILD-64 flagged
  (it found the "(Demo)" leak on the impact PDF after BUILD-58 fixed it on
  pages). **Fixed** as part of the Part 2 sweep.
- **Transactional-vs-marketing suppression (W-4)** and **sent-only-after-
  delivery logging:** pinned green by `mail-suppression` (31) + `notify-delivery`
  (27); receipt/year-end route through `donorMailDecision` (transactional) and
  stamp `sent_at` only on delivery. No new leak found here.

---

## Verification

`bash tests/run-all.sh` — the full battery (now including `build65`) is green:
**102 suites, 0 failed** locally against the scratch stack (the earlier 178s run
had one expected red — `donor-front-door`'s old BUILD-49 PDF-CTA assertions,
which Part 5 reverses and this build updated). Suites touched by BUILD-65 and
re-run green: `build65` (24) · `theme-assets` (59) · `stripe-disputes` (24) ·
`webhook-manifest` (15) · `donor-front-door` (43) · `reconciliation` (13) ·
`giving-flow-brand` · `mail-suppression` (31) · money suites (`state-diff`,
`state-diff2`, `concurrency`/`2`, `gift-idempotency`, `webhook-ordering`,
`report-truth`) all green.

**Pre-existing, out of scope, NOT caused by BUILD-65:** `tests/uploader.test.js`
has one failing assertion — *"Donors.jsx: all 3 CSV import sites pass fileMeta
(found 2)"* — a client-source (`Donors.jsx`) check; BUILD-65 made zero client
changes, and `uploader` is not in `run-all.sh`'s battery. Flagged for a separate
look.

---

## §worry — where this is thin, and what I chose not to do

- **Part 3 (crop on the remaining slots) is NOT done this pass.** Extending the
  BUILD-61 non-destructive crop to campaign hero, impact photo (an *array* of up
  to 4), widget image, and logo is a standalone frontend build whose core
  requirement — **preview equals render, pinned per slot** — needs the crop
  rectangle applied identically in each distinct renderer (campaign card, impact
  card, widget view, logo) and verified in a real browser. I could not verify
  preview==render across those renderers in this autonomous session, and shipping
  an *unverified* non-destructive crop across donor/money surfaces is worse than
  not shipping it — a subtly-wrong rect silently mis-frames a customer's photo.
  The server foundation to build on: `header_crop` + `parseCrop` (BUILD-61)
  generalize to per-slot crop columns; impact photos need a parallel crop array;
  focal point stays the fallback. This is the honest call, not a hidden gap.
- **Responsive variants are still generated on request, not at upload.** The
  decision table said "generate the responsive variants at upload." The donor-
  facing outcome it wants — a phone getting a ~400–800px banner, never the
  master — is already met by the `?w=` route (immutable per-width caching, one
  CDN fetch per width). Pre-generating every width at ingest is a storage/first-
  request-latency micro-optimization, not a correctness gap; I kept the on-request
  path and resized the *master* down on ingest (the part that actually stopped
  15MB masters landing in the store). If pre-generation is wanted, it's a small
  follow-up in `putThemeAsset`.
- **`charge.dispute.funds_withdrawn` stays unhandled** (see Part 7). It's a
  deliberate choice to respect BUILD-58's hold-until-resolved policy, but it does
  mean the *only* reversal trigger is `closed`/`lost`. If a processor emits a
  `funds_withdrawn` without a following `closed`, the money is withdrawn at
  Stripe while the gift stays live — the reconciliation guard
  (`refunded_charge_with_live_gift`) is the backstop, not this handler.
- **`orgs.logo_data` (legacy BUILD-13 app-UI branding) still base64 + 350KB.**
  It feeds the in-app sidebar/greeting mark and is a *fallback* in
  `resolveOrgBrandTheme`, superseded by `portal_settings` for every donor
  artifact. Not a donor-facing regression, so left alone — but it is the last
  base64-era upload path in the codebase and worth migrating to the asset seam
  in a future pass.
- **The 4MB test uses pure noise** (near-incompressible), so its stored master
  is ~2.6MB — the test asserts "smaller than the original" + "≤2560px" rather
  than an absolute size. A real photo compresses to a few hundred KB; the width
  cap is the real resize proof. Honest, but a real-photo fixture would show the
  win more vividly.
- **Not drilled against a real S3 bucket.** `resolvePdfLogo` reads through
  `getThemeAsset`, which in prod fetches from Tigris; the local suite exercises
  the DB-fallback driver. The prod path is the same `getThemeAsset` the public
  `/portal-assets/:id` route already serves live, so the risk is low — but the
  first prod receipt for an S3-backed logo is the real proof.
