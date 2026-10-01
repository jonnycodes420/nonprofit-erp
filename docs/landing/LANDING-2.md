# LANDING-2 · The full marketing site

**Runs in parallel with FIX-11.** Its own Claude Code tab, its own worktree, its own branch. It touches marketing files only, so it should never collide with FIX-11. Merge order: whichever finishes second rebases onto main first.

## Setup

```
cd ~/nonprofit-erp && git pull
git worktree add ../steward-landing-2 -b landing-2 origin/main
cd ../steward-landing-2
```

Jonathan drops two files into `docs/landing/`: `steward-site.html` and `photo-manifest.md`. The HTML is the Cowork artifact "Steward Website": 60 pages in one file, using hash routes. Read it first. It is the source of truth for structure, copy, colour, type and spacing. Copy exact values out of it. Do not round to a grid or swap in framework defaults.

## Rules for running alongside FIX-11

1. **Marketing files only.** New files under the frontend's marketing area plus the router entries for the new public routes. Do not touch the app, auth, donor portal, giving pages, import, `server.js`, `routes/*` or any shared component the app uses. If a change seems to need app code, stop and write `BLOCKED-landing-2.md`.
2. **Never run the full battery while FIX-11 is running one.** Two concurrent batteries turned a 5-minute gate into 3 hours once. While building, run only the landing and frontend suites. Run the full battery once at the end, when the FIX-11 tab is idle, then PR.
3. **Rebase, don't merge.** Before the PR: `git fetch && git rebase origin/main`, re-run the landing suites, then push.
4. Log start and end times. Battery once, PR, merge on green CI, confirm both SHAs.

## What to build

**Real routes, not hash routes.** Map every `#/x` in the reference to `/x`:

- `/` homepage (lean version: hero, research strip, Why tabs, AI band, products, searchable features, people reel, guide band, FAQ, commitment, ready)
- `/platform`, `/crm`, `/volunteer`, `/agent`, `/connections`, `/onboarding`, `/pricing`
- `/features` and `/features/:slug` (14 slugs, one template, data in one module)
- `/why`, `/leadership`, `/move`, `/move/spreadsheet`, `/move/crm`, `/for` and `/for/:slug` (4), `/security`, `/about`, `/partners`, `/contact`, `/demo`
- `/resources`, `/guides` and `/guides/:slug` (5), `/templates`, `/articles`, `/articles/state-of-retention`, `/glossary`, `/faq`, `/help`, `/whats-new`
- `/tools`, `/tools/retention`, `/tools/lapsed-cost`, `/tools/thermometer`
- `/legal/privacy`, `/legal/terms`, `/legal/accessibility`

**Collisions: existing app routes win.** Before adding any route, check the router. Known ones to keep as they are:

- `/developers` already exists from INT-5. Link to it; do not build a marketing copy.
- `/lost-and-found` already exists. `/tools/lost-and-found` is the marketing page that links into it.
- `/login`, `/signup?plan=seed|sapling|orchard` stay as they are.

If anything else collides, list it in the report and leave the app route alone.

**Shared shell.** One header with the three mega menus (Platform, Why Steward, Resources) plus Pricing, the mobile drawer, and the five-column footer, used by every marketing page. Breadcrumbs on every inner page.

**Data in modules, not pasted markup.** Features, audiences, guides, glossary, templates, stats and sources each live in one data file, the way the reference's `FEAT`, `AUD`, `GUIDES`, `GLOSS`, `TEMPL`, `STATS` and `SRC` objects do.

**The people reel.** Jonathan, Winfield, Ross, Brad. It slides on its own, no buttons, pauses on hover, and stops for `prefers-reduced-motion`. Names and titles exactly as in the reference. No origin story anywhere on the site.

**Research numbers.** Use the `STATS`, `QUOTES` and `SRC` objects exactly. Every number keeps its source link. Do not add, round or reword a statistic.

**Book a demo form (`/demo`).** Store the request as a lead in the same place Lost & Found leads show in super-admin, and show the thank-you state. Steward never emails the prospect. Jonathan follows up himself.

**Calculators.** Port the three tools as they work in the reference. Everything is computed in the browser and nothing is sent anywhere.

**Photos: real ones on prod.** Every photo slot gets a real photo before this ships. Use `docs/landing/photo-manifest.md`: a theme per caption, free Unsplash candidate IDs and a fallback search for each. Download each photo, check it really matches its caption, and save it as WebP at 2x the slot size. Log every photo used in `docs/landing/photo-credits.md`. No credits on the page. The four people on the reel and Leadership use the portraits already live on the current landing page (Jonathan, Winfield, Ross, Brad). Find them in the repo where the current landing's "People behind Steward" section loads them and reuse those exact files. Do not swap in stock photos for real people.

**SEO basics.** A title and meta description per page, Open Graph tags, `sitemap.xml` and canonical URLs.

**Legal pages.** These ship with the "Draft for attorney review" badge as shown. Privacy goes first, because Google verification needs a privacy URL. Report the final URL so Muse can paste it into the Google consent screen.

## Guards (add to the landing suite)

- No em dashes in any marketing copy.
- None of the banned outcome words: recovered, re-engaged, reengaged, recaptured, won back, brought back.
- No competitor names anywhere on marketing pages.
- No testimonial or customer quote unless it is in an approved list (empty today). The sourced research quotes in `QUOTES` are allowed.
- Every element in `STATS` renders with its source link.
- Every internal link on every marketing page resolves to a real route (crawl the route list, fail on any 404).
- `landing-prod-verify.js` updated to the new page and green.
- No horizontal scroll at 390 on any marketing route.

## Cut line at 2 hours

1. Shell, homepage, pricing, the 14 feature pages.
2. Products, Why, Move, Security, About, Demo with lead capture, Privacy.
3. Everything else.

## For Muse after deploy

Walk every route at 1440 and 390. Click every menu item and every footer link. Submit the demo form and confirm the lead appears in super-admin. Paste the privacy URL into the Google consent screen.

## REPORT

- What shipped, with routes listed.
- Any route collisions and how they were left.
- Photo credits file path.
- Guards added.
- Start and end times, both SHAs.
