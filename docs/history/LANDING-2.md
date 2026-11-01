## LANDING-2 · the full marketing site (2026-09-30 → 2026-10-01)

The single landing page became the 59-route site from the approved reference
(`docs/landing/steward-site.html`), on real paths instead of hash routes. One
shell (three mega menus, Pricing, the mobile drawer, the five-column footer),
breadcrumbs on every inner page, and every page's copy in data modules under
`client/src/marketing/data/` the way the reference keeps FEAT, AUD, GUIDES,
GLOSS, TEMPL, STATS, QUOTES and SRC. The reference's stylesheet is copied value
for value and scoped under `.mk`, so none of it reaches the app.

Collisions were left to the app: `/pricing` (live checkout, the upgrade modal
and Settings use it) and `/lost-and-found` stay app pages and the site links to
them; `/privacy` and `/terms` stay the live documents while `/legal/*` ship as
attorney drafts. `/developers` was named in the brief but does not exist, so
Open API links point at the Open API row on `/connections`.

45 real photographs replaced every stand-in (free Unsplash, each checked
against its caption, logged in `docs/landing/photo-credits.md`); the four
people use the portraits the old landing page already shipped. The demo form
stores a lead through the existing Lost & Found lead route (`ref` book-a-demo);
storing its two optional fields needs app code and is in `BLOCKED-landing-2.md`.
Guards: `tests/landing2-marketing.test.js` (source) and the rebuilt
`scripts/landing-prod-verify.js`, which crawls every route at 1440 and 390.
