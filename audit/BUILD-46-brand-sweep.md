# Phase 2 / BUILD-46 — pre-hydration & brand-surface sweep (2026-08-08)

**Cause of the reported symptom (confirmed first, not assumed):** the "loading
screen with old green + old 'S' mark" is NOT the pre-hydration splash in
index.html (index.html has no splash markup). It is the **App shell's own
"Loading your workspace…" splash** (`client/src/App.jsx`), whose "S" badge
background and spinner used `T.green` = **`#10b981`** — the retired off-brand
"AI green". Fixed to the OG-badge treatment (Emerald `#0d5c3a` badge + Cream
serif S) with an Emerald spinner.

## Method
Per the brief, the old green was **not** hunted by value. Every color literal
present on each listed surface was enumerated and diffed against the Phase 2 set
— Ink `#0F1A12`, Cream `#F0EDE6`, Cream-alt `#E8E4DB`, Brass `#C9A84C`, Emerald
`#0D5C3A`, Sage `#8FA896`, Warm-grey `#6B6560` — plus the accepted neutral ramp.
Anything outside is listed below with file, purpose, and a legitimacy call.
Raster assets (favicon/apple/android/og PNGs) were pixel-sampled with `sharp`.

## Surfaces, in the briefed order

### 1. OG / social preview image — **PRESENT-AND-FIXED**
`client/public/og-image.svg` + `.png` (1200×630). Enumerated literals:
`#0f1a12` Ink ✓ · `#f0ede6` Cream ✓ · `#c9a84c` Brass ✓ · **`#1a6b4a`** (old
primary green — the S-badge) ✗ · **`#a3b8a8`** (subhead — off-set light sage) ✗
· `#6b8f7a` (tertiary tagline — a documented sage-ramp token, accepted).
Fixed: badge `#1a6b4a → #0d5c3a` (Emerald), subhead `#a3b8a8 → #8fa896` (Sage).
PNG regenerated from the corrected SVG via headless Chrome (proper Georgia
serif); re-sampled: Emerald 11,392 px vs 36 residual anti-alias, no old green.
`linkedin-cover.svg`/`.png` had the identical defect — fixed the same way (not
on the briefed list, but the same asset class and first-impression surface).

### 2. favicon.ico / favicon.svg — **CONFIRMED-CLEAN**
`favicon.svg`: `#0f1a12` Ink rect + `#f0ede6` Cream serif S. On-brand.
`favicon.ico` / `favicon-16/32.png`: sampled → Ink + Cream serif S, no green.

### 3. apple-touch-icon / PWA manifest icons — **CONFIRMED-CLEAN**
`apple-touch-icon.png`, `android-chrome-192/512.png`: sampled `#081810`≈Ink +
`#f0e8e0`≈Cream serif S, no green. `site.webmanifest`: `background_color` /
`theme_color` = `#0f1a12` Ink ✓. index.html `theme-color` meta = `#0f1a12` ✓.

### 4. login / logout / invitation-accept — **PRESENT-AND-FIXED (auth bucket)**
- **`#1a6b4a`** (old primary green, self-labeled "greenDk/greenDark") was the
  links/accents/submit-button green on `LoginPage`, `InvitePage`,
  `ForgotPasswordPage`, `ResetPasswordPage`, and `SignupPage` (login's twin).
  The 2026-07-30 auth sweep moved auth accents to forest `#0d5c3a` but missed
  this. Fixed `#1a6b4a → #0d5c3a` (Emerald) across all five.
- `Invitation.jsx` (the `/invitation` request form): all literals in-set except
  **`#e0a893`** — the `role="alert"` error text on the ink section. **Legitimate
  (semantic error on dark)**; a light terracotta tint for AA on ink. Could align
  to the terra ramp `#eac6b8` for exactness — left as-is (a semantic error color,
  which the brief exempts).
- **logout**: no branded screen — logout clears localStorage and redirects to
  `/login`. Nothing to brand. **CONFIRMED-CLEAN.**
- Auth-page neutral text greys (`#0f0f0f`, `#1a1a1a`, `#2a2a2a`, `#6b6b6b`,
  `#ddd9d0`, `faf6f3`/`f8f6f0` cream tints): the public-theme neutral ramp —
  **accepted neutral ramp** (public pages use a neutral ink vs the app's green
  ink; a documented, non-urgent consistency nit, not a defect).

### 5. route-transition / Suspense fallbacks / skeletons — **FIXED + CONFIRMED-CLEAN**
- **App splash** ("Loading your workspace…", App.jsx): `T.green` `#10b981` badge
  + white S + `#10b981` spinner → **Emerald `#0d5c3a` badge + Cream `#f0ede6` serif S (matching the OG) + Emerald spinner**. This is the reported
  loading screen. **PRESENT-AND-FIXED.**
- **Suspense `RouteFallback`** (main.jsx): cream `#f0ede6` + `#d4cfc6` track +
  `#0d5c3a` Emerald spinner. **CONFIRMED-CLEAN.**
- **Pre-hydration body bg** (index.html): `#030712` blue-black (off-palette, not
  Ink) → **`#0f1a12` Ink**. Removes the pre-hydration blue flash. **FIXED.**
- **Dashboard skeleton** (in-app placeholder): brand-allowlist-guarded — all
  literals are on-palette values (suite green). Its residual `#1a6b4a` usages are
  the documented in-app component backlog, not a loading-surface defect.

### 6. 404 / error boundaries — **FIXED + CONFIRMED-CLEAN**
- **404**: no dedicated 404 page — `<Route path="*">` redirects to `/`. Nothing
  to brand. **CONFIRMED-CLEAN.**
- **`RootErrorFallback`** (main.jsx): cream `#f0ede6` + `#b8593f` terracotta
  heading (semantic error ✓). **CONFIRMED-CLEAN.**
- **`ErrorFallback`** (shared.jsx, the in-app ErrorBoundary): "Something went
  wrong" in `T.terracotta` (semantic ✓), "Go Home" in `T.gold` Brass (primary
  ✓), but "Reload" used `T.greenMid` = **`#1a6b4a`** (old green) → **`T.greenDk`
  `#0d5c3a`** Emerald. **PRESENT-AND-FIXED.**

## Flagged, NOT changed tonight (documented, out of the briefed surfaces)
- `client/src/pages/publicTheme.js` `greenDk: "#1a6b4a"` — feeds **Donate** +
  **ManageFundraiser** (public donation surfaces, not on tonight's list). An
  off-Phase-2 green token; recommend aligning to `#0d5c3a` in a public-pages pass.
- `client/src/pages/Landing.jsx` `greenMd: "#1a6b4a"` — a secondary landing
  accent (landing not on tonight's list; has its own guards).
- `Donate.jsx` S-badge — a public greeting mark; verify its green in the same
  public-pages pass.
- Public-theme neutral ink greys (§4) — accepted neutral ramp; optional alignment.

## Verification
`eslint src` clean (Vercel build gate); brand-glyph 66/66, brand-allowlist
27/27, palette 26/26, no-emoji green. Splash + OG rendered and eyeballed:
`docs/build46-brand-2026-08-08/` (loading-splash.png = Emerald badge + Cream serif S + Emerald spinner; the OG = Emerald badge, Sage tagline, no old green).
