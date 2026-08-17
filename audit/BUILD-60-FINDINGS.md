# BUILD-60 — THE GIVING PAGE BELONGS TO THE ORG, AND RECURRING IS THE ASK — FINDINGS

Honest status. This session delivered the build's **core and title** — Part 1
(the giving page is the org's page) and Part 2 (recurring is the ask) — fully,
tested, and green. Parts 3 (crop control) and 4 (portal layout) are **not done**
and are scoped below. Nothing in the payment or webhook path was touched, and
every Stripe-facing suite stayed green **without modification**.

## What shipped (done + verified)

### Part 1 — the giving page is the org's page ✅
- **Server**: `giveThemePayload(org)` (server.js) builds the org's own theme —
  white-label display name (never the staff-side "(Demo)" name), logo, header
  banner + focal point, primary/accent/button colors (through the ONE
  `portalCardTheme`/`normalizeAccent` resolver the portal already uses), type
  pairing, card style, footer/EIN/contact, and the `poweredBy` flag. Fed into
  **all three** public give payloads (`/org/:slug/public`,
  `.../giving-page/:pageSlug/public`, `.../fundraiser/:fSlug/public`). An
  unthemed org falls back to the **designed neutral portal default** — never
  Steward's emerald `#0d5c3a`/`#10b981`.
- **Client** (`Donate.jsx`): every control, color, logo, type pairing and banner
  now comes from `org.theme`. The old Steward serif **"S"** box is replaced by
  the org's logo (or a monogram in the org's own primary color); the loading /
  error / thank-you / card-updated screens carry no Steward wordmark; **"Powered
  by Steward" is OFF** and gated behind `theme.poweredBy` (a flag, so the network
  distribution asset can be turned on later without a rebuild — the decision the
  brief invited an override on). The org's banner renders with its focal point,
  capped at `min(30vh, 220px)` so it never eats the give form.
- **Battery**: `tests/giving-flow-brand.test.js` (34 asserts, in run-all) — the
  same shape as the org-blindness check: for each of two themed demo-shaped orgs,
  the give payload carries the org's own theme and NO Steward emerald, NO
  "Steward" string, NO "(Demo)" leak; poweredBy defaults off. Permanent.

### Part 2 — recurring is the hero ✅
- **Frequency comes first**, above the amount; **Monthly is pre-selected**.
- **Per-frequency, org-configurable amount ladders** — new
  `portal_settings.onetime_amounts` / `monthly_amounts` (JSON, 3–6 tiers,
  validated on `PUT /portal-settings`; NULL = the built-in default: one-time
  `25/50/100/250/500`, monthly `10/25/50/100/250`). The active ladder's default
  tier is pre-selected; switching frequency re-selects the new ladder's default
  tier (never carries an amount across). One-time stays one click away as an
  equal peer, never a footnote.
- **The disclosure (non-negotiable)**: the submit button states the commitment in
  full — **"Give $25 every month"**, never a bare "Give". Immediately beside it,
  in body text: **"$25 every month until you cancel — $300 a year. Cancel anytime
  from your donor account."** Nothing about the recurring nature is smaller,
  lighter, or lower-contrast than the amount. (The thank-you screen + receipt
  already restate schedule/cancel via existing BUILD-45/57 machinery.)
- **Kept exactly**: fund preselect, fee-cover option, and every Stripe path.

### Verify-first + regression
- Verify-first RED committed at `audit/build60-verify-first-red.txt`: the
  brand-leak assertion AND the frequency-default assertion both fail (22/34) when
  run against the pre-build server + pre-build Donate.jsx.
- Green after: `giving-flow-brand` 34/34, and no regression in the surfaces I
  touched — `portal` 67, `portal-page` 44, `theme-assets` 59, `theme-depth` 27,
  `portal-designation` 23, `donor-front-door` 44. **Stripe-facing untouched and
  green**: `attribution-completeness` 75, `gift-attribution` 36,
  `consistency-e2e` 65. Client build (eslint + brand-allowlist + vite) clean.

## What did NOT ship (scoped, not started)

### Part 3 — a real crop control ❌ (the biggest gap)
Not built. This is a multi-day build: a drag/resize/zoom crop rectangle
constrained to each slot's ratio, storing **normalized coordinates** against the
original asset (non-destructive — never re-encode, never prune the original,
per BUILD-56), applied to **every** image slot (banner, campaign hero, impact
photo, widget image, logo), with focal point as the fallback and preview==render
pinned by test. **Approach when picked up**: add a per-pointer normalized-crop
column (like BUILD-59's `header_focal_x/y`, but a `{x,y,w,h}` rect) beside each
image pointer; extend `PortalBanner`/`bannerImgStyle` to apply the crop via
`object-position` + a scaled/translated inner image (or a wrapper with
`overflow:hidden`); reuse `PortalBannerPreview` as the editor rect UI (it's
already the render, which is what makes preview==render provable). The focal
point stays the fallback for un-cropped slots and off-ratio renders.

### Part 4 — portal layout fixes ❌ (gated behind Part 3, and risky half-done)
The brief explicitly gates Part 4 behind Parts 1–3 being green. The four fixes
(banner viewport cap, impact photos full-width, grid holes, header-row
treatment) all live in `Portal.jsx`/`PortalWidgets.jsx`, whose layout is pinned
by the **browser** batteries `portal-visual` (CLS 0, banner ratio) and
`portal-contrast`. Making them half-done without re-running that browser battery
risks reddening it, so they are deferred as a clean unit rather than shipped
loose. The banner-eats-fold instinct is partially addressed on the *give* page
(the `min(30vh,220px)` cap), but the **portal** banner cap + the other three are
not done.

### Returning-donor last-gift default ❌
Not wired — the public give page is anonymous and has no donor identity to key
off (see `BLOCKED-build60.md` §2). Every other Part 2 item shipped.

## §worry

1. **This build makes Monthly the default path for EVERY donor on EVERY org, and
   the live-key Stripe recurring drill STILL has not run.** The brief flagged
   this itself, and it is right: raising monthly from "third button" to "the
   default ask" multiplies the blast radius of any real-Stripe recurring bug. The
   mock lied in seven load-bearing ways (BUILD-57); those are fixed and pinned,
   but `BLOCKED-stripe-live-drill.md` is still the gate, and it is now more
   load-bearing than ever. **No real nonprofit should get monthly-default in prod
   before that ten-minute live drill runs.**
2. **The disclosure is plain-language, not legally cleared.** Pre-selected
   recurring + a stated commitment is precisely the negative-option pattern that
   produces disputes when done quietly — we did it loudly, which is the right
   instinct, but state auto-renewal law compliance is an attorney conclusion, not
   a code one (`BLOCKED-build60.md` §1).
3. **Deploy is NOT done.** These changes are committed locally on the working
   branch only — **not pushed, not deployed, not SHA-verified live.** db.js gains
   two columns (a one-time re-init on first boot after deploy). The full
   `run-all.sh` battery + CI + the SHA-verified prod deploy are Jonathan's call,
   because (a) the build is partial (Parts 3–4 open) and (b) pushing to main
   deploys to prod, which is an outward action I won't take autonomously on a
   half-finished build.

## Three worst-looking surfaces right now
1. **Orgs still cannot COMPOSE their images** — Part 3 never landed, so an org
   whose banner/hero/impact photo is framed wrong can only nudge a focal point,
   not crop. This is the build's largest unbuilt piece.
2. **The portal itself is still visually rough** — banner eats the fold, impact
   photos read as clip-art thumbnails, the quote card leaves a grid hole, the
   header row is three unrelated things. Part 4, untouched.
3. **A recognized monthly donor still sees the generic ladder default** on the
   give page, not their last gift — the anonymous-page identity gap.
