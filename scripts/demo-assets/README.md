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
