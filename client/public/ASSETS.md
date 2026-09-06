# Landing photography — sources & licenses

## public/photos/ — the photograph pass (2026-09-06)

Supplied by Jonathan inside the design source `docs/build81/landing/proposal.html`
(embedded JPEGs, extracted verbatim to `docs/build81/photos-src/*.jpg` and
derived to webp here). The brief described them as Jonathan's own; the honest
per-photo record, from comparing against this repo's history:

| File(s) | Photograph | Provenance (as verifiable from this repo) | Where it renders |
|---|---|---|---|
| `photos/church{,-2x}.webp` | white country church steeple above autumn trees, golden hour (3:2) | NEW — no prior record here; per Jonathan, his own | Who it's for |
| `photos/shelter{,-2x}.webp` | three shelter dogs at a kennel fence (3:2) | NEW — no prior record here; per Jonathan, his own (distinct from the two-dog Unsplash `card-rescue`) | Who it's for |
| `photos/museum{,-2x}.webp` | students on a museum floor under a hanging installation (3:2) | NEW — no prior record here; per Jonathan, his own | Who it's for |
| `photos/chapel{,-2x}.webp` | small hillside chapel at dusk (4:5) | the SAME photograph as `card-faith` below — Kevin Mueller, Unsplash (free tier, commercial OK) — at a different crop | When a card stops |
| `photos/potter{,-2x}.webp` | hands shaping a clay pot on a wheel (4:3) | the SAME photograph as the retired `band-studio` — Earl Wilcox, Unsplash (free tier, commercial OK) | Your data |
| `photos/doorway.webp` | a gallery interior seen through open doors (decorative background, alt="" aria-hidden) | a WIDER crop of the SAME photograph as `card-arts` below — Dillon Wanner, Unsplash (free tier, commercial OK) | the closing, at 0.28 opacity under the ink gradient |

Every use is license-safe either way (the Unsplash license needs no
attribution). The earlier `who-*` derivations and the `donor-map-shot`
were REMOVED with the photograph pass (the record section is deleted).

# Historical record (BUILD-28 Unsplash set)

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
| **How-it-works screenshots (FIX after BUILD-81)** — three REAL product screenshots for the section-two cards: the Log-a-conversation panel, the next-step prompt (+7 default), The Thread on Home. Captured from the demo org by `scripts/build81-capture.js --landing-shots` (1440 / DPR 2, tight crops; donor names are the demo file's fiction, Atkinson records excluded) | `hiw-{log,nextstep,thread}{,-2x}.webp` | screenshots of the product | — | product's own imagery |
| **The record — donor map screenshot (BUILD-81)** — a real capture of the product's Donor Map view over the 25-donor SAMPLE fixture (no real donor data; pins only, no names visible) | `donor-map-shot{,-2x}.webp` | screenshot of the product; base map tiles © OpenStreetMap contributors (ODbL) — attribution rendered in the caption under the image | https://www.openstreetmap.org/copyright | OSM tiles: attribution required and provided on-page |

| **"Who it's for" strip (FIX after BUILD-81)** — the pre-BUILD-41 page's photographs restored to the page as a three-across strip, cropped 3:2. DERIVED from the committed card files above (`who-church` = a 3:2 band of `card-faith-800`; `who-shelter` = `card-rescue-800`; `who-arts` = `card-arts-800`) — same photographs, same provenance rows above. NOTE: the restore instruction described the church and shelter photographs as Jonathan's own; the audit record here and the BUILD-28 commit messages say Unsplash (Mueller / Sashina / Wanner), and no other church or shelter photograph exists anywhere in git history. The Unsplash license permits this use either way; if Jonathan has his OWN photographs, they were never committed — drop them in over `who-*{,-2x}.webp` and correct this row. | `who-{church,shelter,arts}{,-2x}.webp` | see the three card rows above | see above | Unsplash (free, commercial OK) |

**BUILD-81 note:** the verticals cards left the page with their section (the
BUILD-81 landing has no "Built for orgs like yours" section); the `card-*` files
stay committed as the audit record and for any future reuse.

All three verticals cards carried a photo — the graceful cream-panel + gold-rule
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
