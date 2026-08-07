# BLOCKED — mobile page height: 11,568px vs the <9,000px target

BUILD-40 (2026-08-06) took the 390px landing from **14,988px → 11,568px**
(−23%) with every compression lever that doesn't change WHAT the page says:
padding rhythm, the verticals carousel, hero dead space, shot-internal
compaction, dropping the how-it-works illustrations at phone width, deduping
the queue card's near-identical rows, and type-scale trims. Per-section
heights are in `docs/build40-2026-08-06/after/` (capture:
`scripts/build40-mobile-capture.js`).

**The remaining ~2,600px cannot come from compression — it's content.** The
tallest remaining blocks at 390px:

| block | height | candidate cut | saves |
|---|---|---|---|
| The three product moments | 2,903px | show TWO moments on mobile (queue + recovery email; the receipt is the most skippable — it's also depicted in how-it-works on desktop) | ~700px |
| Founder letter | 1,273px | collapse behind a "Read the letter →" disclosure on mobile (content stays reachable; the trust centerpiece stops costing 1.5 screens) | ~900px |
| Invitation form section | 1,253px | trim the two intro paragraphs to one on mobile | ~150px |
| Candor section | 803px | tighten the three-bullet list to headline claims | ~200px |

Any two of the first two get under ~9,900; all four land ≈ 9,600–9,800. Truly
reaching 9,000 likely also means cutting the "Where the money goes" strip or
the 43% statement — each of which is load-bearing for the pitch.

**Why blocked:** these are editorial/product decisions about what a phone
visitor sees (and the founder letter + candor sections are the honesty brand),
not layout mechanics. Deciding them autonomously would be guessing at
positioning. Every candidate above is a ≤30-minute change once chosen.

**Also deliberately not done:**
- `viewport-fit=cover` in the shared `index.html` meta — it would extend the
  whole APP (not just the landing) into the notch/home-indicator areas and
  needs its own pass. Without it, iOS already keeps content clear; the landing
  footer still pads `env(safe-area-inset-bottom)` as a belt.
- The audit's 3,300ms prod FCP (client-render + font wait) — the hero asset
  work landed (640w variant, preload, aspect-ratio), but moving the hero
  text ahead of the JS bundle means prerendering/SSG for a Vite SPA, a
  separate architectural decision. Measured local FCP is ~100ms; the gap is
  bundle parse + font fetch on real networks.
