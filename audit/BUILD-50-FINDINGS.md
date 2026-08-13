# BUILD-50 — Consumer Surface Design Polish — FINDINGS

**Scope shipped:** design/composition only, in `client/src/pages/GivingDashboard.jsx`
(one file + the two committed scripts). No server routes, no schema, no new data
surfaces — the impact-update `photos` array was already in the `/account/dashboard`
payload; BUILD-50 only renders it.

## What changed

### Part A — `/giving` signed-out landing
- **The first viewport is now the ink field.** The header's ink band bleeds down
  behind the whole hero (`min-height: calc(100vh − 140px)`): cream serif display
  headline on ink with a fluid clamp (`clamp(40px, 4.8vw, 88px)` — 390px still
  works, 2560px reaches 88px), brass eyebrow + rule, the white auth card floating
  on the ink with real elevation.
- **Width ladder.** The landing gets its own wrap: 1200px → 1460px (≥1600px
  viewports) → 1640px (≥2100px), so 2000px+ screens don't strand a small centered
  composition. The signed-in shells widened 880 → 1060 (1200 on very wide).
- **Auth card is compact.** Sign-in = email + password + one full-width button;
  "Email me a sign-in link" and "Reset password" are small quiet links; the
  redundant "Create an account" affordance is GONE from the card — the hero owns
  account creation. All BUILD-49 modes (signup/link/reset, `#signup` entry links,
  `from=` courtesy theming) unchanged.
- **Value trio tightened**: brass tick, dominant serif headline, smaller
  higher-leading body — scans in two seconds.
- **The org-blindness promise is a FULL-BLEED ink band**, edge to edge, with the
  promise at display size — no longer a boxed card inside the column.

### Part B — single-org takeover
- **The page opens with the org's header image as a full-width banner** with a
  white identity plaque (logo + name in the org's type pairing, accent rule) set
  against it. **Fallback** for orgs with no header image: a full-bleed solid band
  in the org's primary color carrying the logo (or a serif monogram) and the
  name — never bare cream. Prod `org_creo` had NO header image/logo; the Part C
  seed sets demo assets (checked, per the brief).
- **Identity redundancy removed.** The follow-only takeover no longer renders the
  FollowedCard (logo + name restated under the header). A page-level state bar
  carries only the state + affordances: Give (org button) · Connect your history ·
  Unfollow.
- **Org colors drive the chrome**: tab underline (already org accent), the
  directory "Add" button, the "+ Add another organization" affordance, and the
  AccountPanel's quiet buttons now all take the org's button color inside a
  takeover. Colors remain server-validated (contrast guard + "we adjusted your
  color" messaging unchanged — that lives in Settings).
- **Impact updates render their photos** (first two as a banner strip) in a
  **two-column grid at desktop, single column at 390** — in the takeover AND
  (neutral-chromed, org-eyebrowed) in the multi-org shell.
- **Giving summary presence**: the primary-color strip is larger (serif 52px
  figure) and gains a third cell (last gift, humanized date).
- **Footer reads like the org's site footer**: full-bleed primary-color band with
  the org's name, footer text, EIN, contact — then the quiet trust line. The
  takeover still carries exactly ONE "Steward" mention (the quiet line).

## Verification
- `scripts/build50-capture.js` — **85/85** self-asserting, committed; DSF2 shots
  at **390 / 1440 / 2560** for the landing, the takeover in **both follow-only
  and linked** states, the no-header-image fallback band, and the multi-org
  shell → `docs/build50-consumer-polish/`. The linked fixture is deliberately
  RICH (five years of gifts, receipts, a recurring gift, a fund-TARGETED impact
  update with photos) — the follow-only state is nearly empty by design and is
  the wrong thing to judge layout against.
- **The multi-org containment sweep re-ran green** (no org accent outside that
  org's own sections; header band stays Steward ink) and **`scripts/build48-capture.js`
  still passes 40/40 unchanged** — every BUILD-48 DOM contract (one quiet Steward
  line, `gd-stats` on org primary, tint background, EIN in footer, in-page
  1↔2-org transitions, drill-down theme stash, Settings preview) survived the
  redesign.
- **`tests/org-blindness.test.js` re-ran green (48/48)** — untouched, as it must
  be: this build changed only donor-eyes-only client rendering.
- Full `tests/run-all.sh`: **79 suites, 0 failed** (incl. theme-depth 27,
  donor-front-door 44, donor-dashboard 22, network-directory 59, brand guards).
- `eslint src` 0 errors; client build (brand-allowlist gate included) clean.

## Deliberate calls (spec deviations, documented)
1. **The hero is INK, not cream.** The brief's cadence sketch said "hero (cream)"
   but also asked for the header's ink band "bleeding further down behind the
   hero" so the top of the page isn't a flat cream field. A partial bleed (ink
   top third, cream below, card straddling the seam) was tried on paper and
   read as neither-nor; the full-viewport ink hero is that instruction taken to
   its natural conclusion, matches the main landing's solid-ink hero (BUILD-41),
   and makes the white auth card genuinely float. The promise band stays
   distinct: tall cream trio section between the two ink fields, different
   composition (centered display statement vs. left copy + card).
2. **The landing's small footer was removed** — the full-bleed promise band ends
   the page with the exact trust sentence at display size; repeating it in
   12px grey directly beneath looked like an error. Signed-in states keep the
   footer trust line (and the takeover's org footer band carries it below).
3. **"What your giving made possible" still heads the impact section in the
   FOLLOW-ONLY takeover** (BUILD-48 behavior, unchanged). For a follow there is
   no linked giving, so the heading slightly overclaims. Left alone because
   BUILD-50 is composition-only and the fix is a copy decision ("What donors
   made possible"?) — flagging rather than silently rewording.

## Worry paragraph (read before relying on this)
**Theme assets are base64 data-URIs riding EVERY dashboard payload, and BUILD-50
just made them load-bearing.** The BUILD-48 flag stands and is now sharper: the
header image (≤~500KB validated) and logo are inlined in `portal_settings` and
returned in full on `/account/dashboard` — for BOTH `orgs` and `followed` rows —
plus again in the portal config, plus stashed into sessionStorage on drill-down.
One org with a full-size 400KB header photo makes every dashboard load for every
one of its donors carry that payload; a donor linked to five such orgs downloads
~2MB of JSON before first paint, and sessionStorage stashes can start throwing
quota errors (caught, but the flash-free handoff silently degrades). Nothing
breaks today at demo scale (the seeded SVG bands are <1KB), but before a real
org uploads a real photograph, the header/logo columns should move to
size-capped, cache-friendly URLs (or at minimum the dashboard should return
asset references, not bytes). Second, smaller worry: the takeover banner shows
the image `object-fit: cover` at 250px (300px ≥1600px) — an org that uploads a
tall portrait-crop image will have its subject decapitated, and there's no
in-product preview at THESE dimensions (Settings previews the card, not the
BUILD-50 banner). Cheap fix later: show a banner-shaped crop preview in
Settings › Donor Portal.
