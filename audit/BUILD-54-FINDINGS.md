# BUILD-54 — FINDINGS

## §0 — Reconciliation against "BUILD-52" (pre-build, 2026-08-15)

**There is no BUILD-52 anywhere in this repo** — no commit, no branch, no spec file, no
findings doc, no code comment (`grep -rn "BUILD-52"` over tracked source: zero hits).
The spec's "supersedes BUILD-52" line and the assumption that its block library shipped
are both stale. What DOES exist shipped under BUILD-45/48/50/51/51b (the portal) and
BUILD-34 (the CRM Home section editor). The honest verdict:

> **The block/widget library and the page/layout publish lifecycle do NOT exist.**
> §4 is a first build of the widget system, not a relocation of an existing editor.
> Several expensive ingredients DO exist and must be reused, not rebuilt — listed below.

### What exists today (verified in code, not from docs)

- **Page/widget entities: none.** No `portal_pages`, no blocks/widgets tables. The only
  portal config is the single-row `portal_settings` theme record (colors ×4, type-pairing
  enum, card-style enum, logo/header asset URLs, display name, footer/EIN/contact,
  min-recurring, enabled, network_listed + directory-card fields).
- **Portal rendering: a hard-coded 720px card stack** (`client/src/pages/Portal.jsx`):
  header → welcome/sign-out → account nudge → Your giving (stats + year bars) →
  Recurring self-service → Give CTA → Pledges → Tax receipts → Household → Impact feed
  → footer. Order and presence are fixed in JSX; theme flows through CSS variables.
- **Editor UI: one flat form** (`PortalManager`, Settings.jsx:768) — theme fields, raw
  `<input type=file>` uploads (no drag-drop), explicit Save that goes LIVE immediately.
  No dirty indicator, no navigate-away warning, no preview beyond the banner-crop
  thumbnail. `ImpactUpdatesManager` is a sibling CRUD form.
- **Draft/publish: exists for `impact_updates` ONLY** (`status` draft|published; every
  donor-facing read filters `status='published'` — server.js:15829). Theme/layout has NO
  draft state, no autosave, no revert-to-published, no versioning.
- **Public vs donor-only: partial.** The portal URL is public; theme/header render signed
  out; all content requires a portal session (signed-out = themed sign-in card — which is
  exactly §4's "My Giving degrades to a sign-in prompt" behavior, already shipped).
- **Moderation surface: none for content.** The only human-review queue is the
  AdminDashboard Network Review (org applications/EIN disputes). Impact updates publish
  with zero platform visibility. (Feeds the §7 worry paragraph.)
- **Editor interaction machinery EXISTS in the CRM** (BUILD-34, Dashboard.jsx +
  `client/src/lib/homeLayout.js`): section drag-reorder (native HTML5, midpoint rule),
  keyboard path (focusable handles, arrow keys, aria-live announcements), hide/show +
  hidden tray, zero-layout-shift edit chrome, optimistic save + rollback, reduced-motion
  handling, per-user server persistence with a stale-config merge rule. This is the
  proven in-house pattern §4's editor ports to the portal — not a system to invent.
- **Widget data sources that already exist:** theme header asset (BUILD-51 seam →
  Hero), `impact_updates` + deterministic matcher (→ Impact feed), `fin_funds` +
  fund-designated `giving_pages` (→ Programs/Funds cards), `/give/:orgSlug` (→ Give
  CTA), the current portal dashboard content (→ the My Giving widget, verbatim).
- **§2 head start:** `matchImpactUpdates` (server.js:15826) ALREADY matches on the
  gift's **campaign** attribution as well as fund, with the 24-month window and
  targeted-first/org-wide-fallback ordering; `validImpactTargets` already accepts
  `kind:'campaign'`. Portal gift rows already show the raw campaign name
  (`· {g.campaign}`). What §2 adds is the donor-facing campaign fields (campaigns has
  NO donor-facing columns — verified db.js), the labeling override, goal-progress
  opt-in, thank-you state, and receipt-email content.
- **§1 flag status:** `idx_donors_lower_email` partial index EXISTS (db.js:1738, added
  at go-live 887bf2e) — measure before assuming the link query is still slow.
  `pruneImpactAssets` (server.js:16111) does an org-scoped all-updates scan per write —
  real but org-bounded; rank it by measurement.
- **Safety batteries to re-run are intact:** `tests/portal.test.js` portal↔staff
  differential sweeps (both directions), `tests/org-blindness.test.js` byte-equality,
  `scripts/build48-capture.js` / `build50-capture.js`.

### §4 verdict — build / extend / reuse

| §4 concept | Status |
|---|---|
| Page entity, widget instances, layout order | **New** (data model + renderer) |
| Draft/publish + autosave + revert for the page | **New** (generalize the impact_updates pattern) |
| Edit-mode route (staff session, org-scoped, admin-only) | **New** |
| Sample-donor rendering in edit mode | **New** (CRM sample-data loader is a data source to adapt, not a mechanism) |
| Device toggle (phone default) | **New** |
| In-place image drop | **New** (rides §6's shared uploader + the BUILD-51 asset seam) |
| Starter layouts | **New** |
| Sanitized rich text as structured data | **New** (nothing donor-facing renders HTML today — impact body is plain text) |
| Widgets: Rich text, Gallery, Org stats, Quote, Staff/contact, FAQ, Video | **New** |
| Widgets: Hero, Impact feed, Programs/Funds cards, Give CTA, My Giving, Campaign spotlight | **Extend existing data/render** (spotlight blocked on §2 fields) |
| Drag/reorder/hide editor interactions | **Port BUILD-34 machinery** |
| Theme system (CSS vars, contrast guards, pairings, card styles) | **Reuse as-is** — widgets inherit it |
| Asset storage/validation (BUILD-51 seam, content-addressed, pruning) | **Reuse; add widget-image kinds** |
| Magic-link auth, recurring self-service, receipts, household, thin-data honesty | **Do not touch** |
| Public-page degradation of My Giving | **Already shipped** (signed-out portal behavior) |

---

## §1 — Performance: BEFORE numbers (measured 2026-08-15, prod unless noted)

### Page loads (Playwright vs prod; cold = empty cache, warm = reload)

| Surface | Cold settle | Warm settle | FCP cold | Notes |
|---|---|---|---|---|
| /giving signed out | 1.27s | 1.01s | 520ms | 9 requests, 147KB wire — fine |
| Org portal signed out | 1.64s | 0.96s | 316ms | config via /portal-api proxy: 719ms cold / 192ms warm |
| Staff CRM /dashboard | 3.32s (greeting 1.51s) | 2.22s (greeting 0.88s) | 412ms | 22 API calls in two waves |
| Org portal signed IN (`/portal/:slug/me`, curl) | **0.8–1.7s TTFB** | — | — | one donor, 5 gifts |
| Donor dashboard 2 linked orgs (`/account/dashboard`) | *not reachable on prod without a donor credential* | — | — | **6–17ms on local PG** — see attribution |

### Backend endpoint ranking (prod, demo org, authed, 2 runs each)

/dashboard/today **1,206–1,220ms** · portal /me **819–1,735ms** · /workflows 644–652 ·
/pipeline 644–670 · /metrics/stewardship-summary 630–721 · /impact 501–606 ·
/dashboard/home 501–587 · /recurring/health 466–524 · /billing/status 290–1,222 (Stripe
call server-side, cold) · single-query endpoints (/tasks, /impact-updates,
/donors/summaries) 153–232ms ≈ the network floor from the client (~170ms).

### Attribution (ranked)

1. **Sequential DB round trips inside fat handlers — the dominant cause.**
   `/dashboard/today` ≈ 20+ awaited queries in series (incl. computeAtRiskCandidates
   and helpers); portal `/me` ≈ 15; `/account/dashboard` = the flagged N+1 (4 sequential
   queries **per linked org** plus a `linkDonorAccount` pass on every view); /pipeline 8;
   /impact 6; /metrics 6. Identical handlers run in **4–17ms on local Postgres** — the
   prod cost is Railway↔Supabase round-trip latency (~25–50ms) × query count, serial.
2. **Deploy blackout, not Railway sleep.** The container does NOT sleep (1 start in 2
   days until today's push). But every deploy 503s the whole API with "Database
   initializing" for **~40–70s** while db.js re-runs hundreds of IF-NOT-EXISTS DDL
   statements sequentially against Supabase (observed live during the 18:04 UTC MIGC
   deploy; "Database ready" logged 38s after listen on the 08-14 deploy). Boot to
   listening itself is ~2s. **Railway cold start is NOT the dominant cause — no plan
   decision needed.**
3. **CRM fetch waterfall**: wave 1 (App shell: /org, /donors/summaries, +5) → wave 2
   (Dashboard: 14 more, /dashboard/today the 1.2s long pole). Fixing endpoint latency
   fixes the page.
4. **Hashed bundle assets served `max-age=0, must-revalidate`** — root vercel.json has
   no `headers` config, so every repeat view revalidates every chunk (edge HIT keeps it
   ~90ms each, but it's pure waste). `/portal-assets/*` are CORRECT (immutable, edge
   HIT on repeat) — §1.4's question answered.
5. **Bundle weight is a CRM-side concern only**: entry 253KB + App 510KB + Donors
   **799KB** (import/XLSX machinery) ≈ 440KB gz for staff; donor surfaces ≈ 150KB wire.
6. Memory/CPU flat (0.17GB, ~0 CPU) — no resource pressure, no OOM restarts.

### Fixes shipped (Stage 1) — no caching layers, no new infrastructure
1. **Parallelized the fat handlers** (identical results; bucket-application order
   preserved where upsert tie-breaks depend on it):
   - `/dashboard/today` — 14 sequential queries → one `Promise.all` batch. The two
     receipt-bucket queries now always run (cheap LIMIT-5 reads) but still only APPLY
     when receipts are enabled.
   - portal `/me` — impact matching, the account nudge, and the audit write joined the
     existing parallel batch; the per-subscription live **Stripe API loop** (~300ms
     each, serial) is now parallel.
   - `/account/dashboard` — the flagged N+1 removed: per-org gift/recurring aggregates
     became two `GROUP BY org_id` queries (donor ids are globally unique, so grouping
     over the full donor-id list is exactly the per-org loop), impact matching and the
     follows read joined the same batch.
   - `/dashboard/home` (7→2 waves), `/impact` (6→1), `/recurring/health` (4→1),
     `/metrics/stewardship-summary` (6→1). Known micro-shift: on `scope=all` the debt
     snapshot write and the trend read are now concurrent, so the FIRST view of a day
     may not include that day's fresh snapshot point in the 30-day sparkline (appears
     on the next request) — display-only, self-healing.
2. **Schema-init fast path** (db.js): sha256 of db.js stored in a `schema_meta` row;
   unchanged hash → the ~280-statement DDL storm is skipped (2 round trips). Any edit
   to db.js re-runs the full init exactly once; `SCHEMA_INIT_FORCE=1` is break-glass.
   Post-deploy 503 window: ~40–70s → seedData only (~2–3s). NB the FIRST deploy
   carrying this change still pays the old window (hash mismatch by construction).
3. **vercel.json `headers`**: `/assets/(.*)` → `public, max-age=31536000, immutable`
   (hashed filenames; was `max-age=0, must-revalidate` because the custom
   buildCommand/outputDirectory bypasses Vercel's framework heuristics).
4. **XLSX out of the Donors chunk** (dynamic import at the actual parse site):
   Donors 799KB → 464KB + a 429KB xlsx chunk loaded only when a spreadsheet is dropped.

### AFTER numbers — see the re-measure at the end of Stage 4 (spec §1.6) and the
post-deploy verification in the Stage 1 report.

