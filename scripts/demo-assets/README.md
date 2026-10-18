# Demo photography — sources & licenses

Real photographs used by the demo seed scripts (`seed-build45-portal-demo.js`,
`seed-build54-demo.js`, `fix-build54-demo-photos.js`) for the org_creo demo
portal. They exist because a flat-color SVG "placeholder photo" renders as a
solid brand-color block on the donor page (`object-fit: cover` crops the
caption away) — found live 2026-08-15. **Never seed a `<rect>` SVG as anything
donor-visible** (pinned by `tests/demo-content.test.js`).

All are **free-tier Unsplash** downloads (same sources/license terms as the
landing photography — see `client/public/ASSETS.md`): free for commercial use,
no attribution required, none Unsplash+/editorial. Derived here as small
q72 JPEGs via sharp. Illustrative arts/community imagery on a demo-fiction
org — never captioned as a real customer or real event photography.

| File | Used as | Photographer | Unsplash photo |
|------|---------|--------------|----------------|
| `demo-hero-choir.jpg` (1200×664) | portal page hero widget | Omar Flores | https://unsplash.com/photos/AndwyJNdk1k |
| `demo-impact-exhibition.jpg` (900×600) | impact update "Student exhibition, May" | Dillon Wanner | https://unsplash.com/photos/EeAL5G9HDV0 |
| `demo-impact-studio.jpg` (900×600) | impact update "The studio expansion broke ground" | Earl Wilcox | https://unsplash.com/photos/pSo0u53FF10 |
| `demo-campaign-chapel.jpg` (1200×675, attention-cropped from portrait) | "Steeples and Studios" campaign hero | Kevin Mueller | https://unsplash.com/photos/8IbeGOj9AGA |

The theme **banner** for org_creo is a separate real JPEG already stored as a
prod portal asset — the point of this set is that banner / page hero /
campaign hero / impact photos are all **distinct** images (the same photo
repeated across surfaces read as unfinished — BUILD-54 follow-up).

## FIX-41 · auction item photos (2026-10-15)

Free-tier Unsplash photographs fetched through picsum.photos (which serves
Unsplash photos by id), resized to 1200×800 and saved as q72 JPEGs via sharp.
The Unsplash License: free for commercial use, no attribution required. Seeded
by `scripts/seed/fix41-media.js` on the Harborlight demo's auction items; two
items (the jersey, the golf) are left without a photo on purpose, so the demo
shows the "Add a photo" empty state too.

| File | Used as | Photographer | Unsplash photo |
|------|---------|--------------|----------------|
| `auction-lake-canoe.jpg` | A week at the lake house | Roberto Nickson | https://unsplash.com/photos/7BjmDICVloE |
| `auction-chef-table.jpg` | Chef's table for eight | Webvilla | https://unsplash.com/photos/hv1MrBzGGNY |
| `auction-harbor-boats.jpg` | Harbor sunset sail | Martin Wessely | https://unsplash.com/photos/GDvSktiPIQQ |
| `auction-aquarium.jpg` | Family pass to the aquarium | Marat Gilyadzinov | https://unsplash.com/photos/wpTWYBll4_w |
| `auction-wine-grapes.jpg` | Wine dinner for two | Jassy Onyae | https://unsplash.com/photos/1gBUXhf0PtA |
| `auction-ski-snow.jpg` | Ski weekend | Wolfgang Lutz | https://unsplash.com/photos/yOujaSETXlo |
| `auction-camera.jpg` | Photography session | Nicola Perantoni | https://unsplash.com/photos/irUQaBK3ydI |
| `auction-cooking.jpg` | Cooking class for six | Monstruo Estudio | https://unsplash.com/photos/lQy6mHZ7fYk |

The watercolour and the dinnerware reuse `demo-impact-exhibition.jpg` and
`demo-impact-studio.jpg` above. The giving pages and the volunteer page reuse
the photographs already here and in `client/public/landing/` (provenance in
`client/public/ASSETS.md`).
