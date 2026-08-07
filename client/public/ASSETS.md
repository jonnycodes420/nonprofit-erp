# Landing photography — sources & licenses (BUILD-28)

The image-forward landing (`client/src/pages/Landing.jsx`) uses four photographs
(hero + three verticals cards). All are **free-tier Unsplash** downloads, user-confirmed for commercial use. The
[Unsplash License](https://unsplash.com/license) grants free use for commercial
and non-commercial purposes **with no permission or attribution required**
(attribution appreciated, not obligatory — so no footer credit line is needed;
this file is the audit record). None are Unsplash+ / editorial-only.

The photos are **illustrative arts/community work — NOT Steward customers** and
must never be captioned as such (they render `aria-hidden`, no caption).

| Role | Served files | Photographer | Unsplash photo | License |
|------|--------------|--------------|----------------|---------|
| **Hero** — RETIRED (BUILD-41, 2026-08-06): the choir photo (`hero-choir-*.webp`, Omar Flores, Unsplash) was deleted — the hero is a solid ink field; the image muddied the type and was the LCP bottleneck | — | — | — | — |
| **Verticals card — Arts & culture** — patrons at an arts space | `card-arts-{400,800}.webp` | Dillon Wanner | https://unsplash.com/photos/EeAL5G9HDV0 | Unsplash (free, commercial OK, no attribution required) |
| **Verticals card — Rescue & relief** — shelter dogs | `card-rescue-{400,800}.webp` | Sasha Sashina | https://unsplash.com/photos/Xcscr_sNSEY | Unsplash (free, commercial OK, no attribution required) |
| **Verticals card — Faith & community** — hillside chapel at dusk | `card-faith-{400,800}.webp` | Kevin Mueller | https://unsplash.com/photos/8IbeGOj9AGA | Unsplash (free, commercial OK, no attribution required) |

All three verticals cards now carry a photo — the graceful cream-panel + gold-rule
fallback (still in `Landing.jsx` for any `img: null` slot) is currently unused.

**Retired (FIX 2026-07-30):** the mid-page full-bleed **studio band**
(`band-studio-{1280,1920}.webp`, working pottery studio, Earl Wilcox,
https://unsplash.com/photos/pSo0u53FF10) was removed from the landing — a tight
macro read as *texture*, not a place, and left an orphaned white gap between the
founding-partner ask and the founder letter. The served files were deleted and
the `band-studio` job dropped from `scripts/build28-prepare-images.js`. If a
mid-page breath is ever wanted, use a wide art-studio **room** shot (reads as a
place) at ~half height — not a macro.

Note on the Rescue image: it's a caged-kennel framing. The original BUILD-28
brief preferred a *hopeful* shot (volunteer with an animal / adoption moment)
over caged/pity framing — user-selected this file regardless; swap later if a
more hopeful licensed shot is sourced.

Note on the Faith image: portrait source, cropped to the landscape card via
`object-position: center 60%` (keeps the lit chapel framed).

## Regenerating / swapping
- Responsive WebP variants are produced by `scripts/build28-prepare-images.js`
  (edit the `JOBS` table, re-run). Outputs go to `client/public/` and are
  committed. Deliberately **no `lp-` prefix** so they never trip the landing
  crispness/image guards (which forbid any `/lp-` product `<img>`).
- **Swapping the hero image is one line**: change `HERO_SRC` in `Landing.jsx`
  and the matching preload `href`/`imagesrcset` in `client/index.html`. If a new
  image is used under **CC BY** (not Unsplash), add a footer attribution line.
