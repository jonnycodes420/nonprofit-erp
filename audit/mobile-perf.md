# BUILD-40 — mobile perf + layout, before/after (2026-08-06)

Measured at a TRUE 390×844 Playwright viewport against a local static serve of
`client/dist` (Chrome's minimum window is 500px — a plain resize silently gives
a desktop layout; never verify mobile that way). Local serve means the absolute
network numbers are best-case; the deltas and byte counts are the real story.
Raw JSON: `docs/build40-2026-08-06/{before,after}/metrics.json`; per-section
390px screenshots in the same folders. Capture tool: committed
`scripts/build40-mobile-capture.js`.

## P0-1 — invisible sections (the whole build)

| | before | after |
|---|---|---|
| Sections stuck at opacity 0 after five hard scroll jumps | **4** (verticals band, product proof, candor, founder letter — the audit's live walk hit 8; the set varies by timing, the mechanism was identical) | **0** |
| Reveal design | fail-closed (base CSS `opacity:0`, one-shot IntersectionObserver, no recovery) | fail-open (`html.reveal-ready` scope armed by JS only after recovery sweeps exist; hidden state exists only ≥768px; reduced-motion honored; per-callback recovery sweep + idle pass; rootMargin −10%) |
| Reveals at phone width | armed (and stranding) | **off entirely** |

Pinned by `tests/landing-reveal.test.js` (in `run-all.sh`), which failed 3/7
against the old code and passes 7/7 now — including a real pointer drag of the
calculator slider at 390px.

## P0-2 — hero asset

| 390px viewport | before | after |
|---|---|---|
| Hero variant chosen (DPR 1) | `hero-choir-960.webp`, 66,888 B | `hero-choir-640.webp`, **37,614 B** (−44%) |
| Total page bytes (encoded) | 382,039 B | 359,683 B |
| FCP (local serve, warm) | 104 ms | 96 ms |

Notes:
- The audit's "2560px served to phones" observation came from measuring inside
  a same-origin iframe in a desktop window — `sizes=100vw` reads the OUTER
  window there (1456px × DPR 2 ≈ 2912 → the 2560 file). A real phone viewport
  never chose 2560 (390 × DPR 3 = 1170 → the 1280 file). Still real waste at
  the low end: the new 640w variant + the widened preload `imagesrcset` (in
  `client/index.html`, still route-scoped to `/`) cover DPR-1/2 phones.
- The audit's 3,300 ms FCP on prod is network + font + JS-parse bound and is
  not reproducible on a local serve (96–104 ms here). The headline already
  paints before the photograph (the type is DOM; the photo is a sibling `img`
  that never blocks it), and the hero container now carries an explicit
  `aspect-ratio: 2560/1417` so the image landing can never shift layout
  (CLS was already 0; motion-verify still asserts ≤0.02).
- Verticals `card-*.webp` already served 400w/800w `srcset` (BUILD-28) — no
  change needed; product shots are DOM, not images.

## P1 — page height at 390px

| | height |
|---|---|
| Before | **14,988 px** (~18 phone screens) |
| After | **11,568 px** (−23%) |
| Audit target | < 9,000 px — **not reached; the rest is editorial, see `BLOCKED-mobile-height.md`** |

What got the 3,420px: section padding 116→48px, hero dead space cut (~618px
hero, headline + both CTAs clear a ~700px usable fold), verticals → horizontal
snap carousel, moment/media internals compacted, how-it-works illustrations
dropped at phone width (numbered step text carries it), queue card deduped to
four rows on mobile, founder letter 19→17px, invitation form rhythm tightened.

## P1/P2 spot fixes (all under 768px only)

- CTA pairs full-width + equal (52px min height, 14px gap, primary first) —
  was ~250px/~370px mismatched stack.
- 43% statement left-aligned at 27px/1.35 (was ten centered serif lines).
- Product shot drops the desktop browser chrome (traffic lights + address bar
  under "Not a mockup" was self-undermining on a phone); UI edge-to-edge in
  the rounded card.
- Nav keeps **Pricing** reachable (was display:none → footer-only); "Log in"
  moves to the footer on phones; gold CTA compacts to fit 390px.
- Slider: 30px thumb + 34px-tall hit area (padding + background-clip);
  drag-at-390px is asserted by the committed test.
- Body copy floors at 16px on mobile (verticals blurbs, how-it-works lines,
  candor list); all invitation inputs were already 16px (no iOS zoom).
- Footer/nav links get ≥44px tap boxes; footer pads
  `env(safe-area-inset-bottom)` (belt — without `viewport-fit=cover` iOS also
  insets automatically; the meta was left alone deliberately, it's shared by
  the whole app shell).

## Contrast at small sizes on ink `#0f1a12` (WCAG relative luminance)

| foreground | ratio | verdict |
|---|---|---|
| brass `#c9a84c` | 7.8:1 | AA + AAA-large |
| sage `#8fa896` | 7.0:1 | AA |
| deep sage `#6b8f7a` (money-strip footnote) | **4.96:1** | AA (≥4.5) — the thinnest margin on the page; don't darken it further |

## Verification state after the build

`tests/landing-reveal.test.js` 7/7 (failed 3/7 pre-fix) · funnel 41/41 ·
hero 24/24 (incl. measured AA over the recomposed 390px hero) · motion 8/8 ·
crispness 34/34 · image 18/18 · `eslint` 0 errors · brand-allowlist green via
`npm run build`.
