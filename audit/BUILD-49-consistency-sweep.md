# BUILD-49 — Part 3 consistency sweep (report)

**Date:** 2026-08-09. Prices are **$149 (Core) / $299 (Team)** everywhere.

## `$249` — every hit

Full-repo grep for `$249` / `249/mo` / legacy price strings (excluding
`node_modules`, `client/dist`):

| File:line | Context | Action |
|---|---|---|
| `CLAUDE.md:56` | Legacy `$99/$249/$499` Seed/Growth/Impact price IDs (historical doc) | Left — internal doc of retired legacy tiers |
| `CLAUDE.md:1086` | BUILD-29 note: "money strip still quoted the LEGACY $99/$249/$499 plans → now $149/$299" (historical doc) | Left — internal changelog |

There is **no `$249` in any shipped product/site copy** (client/src, server.js,
index.html, emails, receipts). The only occurrences are historical notes in
`CLAUDE.md`. The legacy `growth` plan object in `Pricing.jsx` still carries
`price: 249`, but `BILLING_PLANS` is dead reference data (not rendered anywhere;
`upgrade-checkout.test.js` guards that the founding plan and legacy set are not
surfaced). It is retained only for legacy-reactivation reference.

## `founding partner` / `five founding` / `founding-partner` — every hit

User-facing copy hits **removed by BUILD-49** (see the diffs in this build):

| File:line (pre-build) | Context | BUILD-49 action |
|---|---|---|
| `client/src/pages/Pricing.jsx:233,237,239` | "invitation-only … five founding partner … founding partners lock in below them" chip | **Removed** — whole invitation/founding paragraph deleted in the pricing rewrite |
| `client/src/pages/Landing.jsx:1205,1223` | "the five founding partners are chosen"; close-line "Five founding organizations · donors imported for you" | **Removed** — landing InvitationSection + founding close-line replaced with "Start free" copy |
| `client/src/pages/Landing.jsx:1053` | how-it-works step: "founding partners get it done for them" | **Reworded** — CSV-import line no longer references founding partners |
| `client/src/pages/Invitation.jsx:110,124,129` | "Founding partners — five organizations" eyebrow + body | **Left in place** — the `/invitation` route is deliberately kept working so old links don't 404 (BUILD-49 §1); its own founding-partner copy is intentional to that standalone page and no longer linked from anywhere |
| `client/src/pages/LoginPage.jsx:71` (comment) + link | "invitation-only while the founding-partner group is chosen" | **Removed** — login "No account?" link now → `/signup` "Start free" |

Non-user-facing hits (billing internals — **left unchanged**, they describe the
real private off-menu price, not public copy):

- `scripts/create-billing-products.js:41,93` — the private founding-partner
  Stripe product + `steward_founding_34off` coupon.
- `billingPlans.js:14`, `server.js:1228,13665`, `db.js:320`,
  `tests/billing.test.js`, `tests/upgrade-checkout.test.js` — the `founding`
  plan enum, its super-admin-only gating, and the guard that keeps it off the
  public page. These are correct and stay.

## `invitation-only` — every hit

| File:line | Action |
|---|---|
| `client/src/pages/Pricing.jsx:237` | **Removed** (pricing rewrite) |
| `client/src/pages/LoginPage.jsx:71` (comment) | **Removed** |
| `client/src/pages/Landing.jsx:1204` (comment) | **Removed** with the InvitationSection block |
| `client/src/pages/Invitation.jsx:5` (comment) | Left — the standalone `/invitation` page is kept; comment describes it accurately |
| `scripts/invitation-capture.js:86` | Verification script for the (now-superseded) invitation-pivot; updated/deprecated in this build |

## Live Stripe product/price objects (report only — CHANGE NOTHING)

This is **money configuration, not copy**, and cannot be verified from this
environment — the live Stripe secret keys live on Railway, not here (per the
project's standing note that there are no Stripe creds in the dev environment).

**Code-configured intent** (`scripts/create-billing-products.js`), the source of
truth used to provision the Stripe products:

- `STRIPE_PRICE_CORE` → **$149.00/mo** (`unit_amount: 14900`, product "Steward — Core")
- `STRIPE_PRICE_TEAM` → **$299.00/mo** (`unit_amount: 29900`, product "Steward — Team")
- `STRIPE_PRICE_FOUNDING` → $99.00/mo (`unit_amount: 9900`, private/off-menu)

**To confirm the LIVE objects actually match $149/$299**, Jonathan should check
one of:
- Stripe Dashboard → Products (live mode), or
- `GET /admin/billing-diagnostic` (super-admin; retrieves each configured price
  with the live billing key and reports per-price detail), or
- `/health` → `billing:{mode,ok,checked}`.

No Stripe object was created, modified, or deleted by this build.
