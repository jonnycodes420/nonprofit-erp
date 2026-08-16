# BUILD-55 FINDINGS — prod-write safety · portal editor layout · three fixes

Overnight pass, 2026-08-15 → 08-16. Parts in build order. Everything below went
through the gated pipeline; nothing ran against prod.

---

## Part 1 — prod-write safety (after the 2026-08-15 banner incident)

### 1.1 Full inventory: every script that can issue writes to a remote host

All 60 `scripts/*.js` were classified (the classification is now ENFORCED —
`tests/script-guards.test.js` fails on any unclassified script, so a future
script must be placed deliberately):

**Writers, now guarded via `scripts/lib/prodGuard.js` (25):**
API writers — the seed/fix family (`seed-build45-asks`, `seed-build45-portal-demo`,
`seed-build50-demo`, `seed-build54-demo`, `seed-creo-goals`, `seed-fundraising-demo`,
`fix-build54-demo-photos`, `fix-demo-finance-ledger`), the migrate/dedupe family
(`dedupe-finance-gift-stamps`, `migrate-plans-core-team`,
`migrate-build51-theme-assets`, `migrate-build51b-impact-photos`), self-seeding
capture scripts (`build25-workflows-capture`, `build35-capture`,
`build36-bulkassign-capture`, `build36-notify-capture`, `build47-capture`,
`build48-capture`, `build50-capture`, `build54-capture`,
`finance-entity-routing-capture`, `invitation-capture` — the last submits a real
form through the browser). DB-direct writers (`backfill-campaign-attribution`,
`extend-trials-free-through-2026`, `load-irs-ein-registry`) use the DB twin
(`writerDbUrl`).

**Found still defaulting to PROD (the headline of this audit) — 4 scripts, all
writers:** `dedupe-finance-gift-stamps.js` (deletes ledger rows via the admin
API), `migrate-plans-core-team.js`, `migrate-build51-theme-assets.js`,
`migrate-build51b-impact-photos.js`. The ddbef92 incident fix flipped the
seed/fix family but missed these four because they aren't named `seed-*`/`fix-*`
— exactly the gap "audit EVERY script, not just seed/fix" anticipated. All four
now default to loopback.

**Also found:** `seed-build50-demo.js`'s theme PUT was still UNCONDITIONAL —
the comment said "seed the demo assets when they're missing" but the code
stomped whatever was there. Even a deliberate, confirmed prod re-run would have
overwritten the real banner again. It now GETs current settings first, skips
the theme write entirely when header/logo assets exist, and snapshots the
current row before any write it does make.

**Hard-refusers (stricter than the guard, left as-is, pinned):** `loadtest`,
`seed-loadtest`, `seed-build46-network-demo` refuse any non-loopback target
outright. **Hardcoded loopback (can't reach prod):** `build45-portal-capture`,
`onramp-capture`. **Read-only prod-defaulting scripts (verified, not assumed:
their only write-shaped call is POST /auth/login):** the five landing verifies,
`consistency-audit`, `screenshot-matrix`, `topbar-verify`,
`finance-overview-capture`, `build12-ui-capture`, `build49-capture`,
`attribution-chips-capture`. **Browser-driving loopback captures (17):** default
loopback, no script-level write fetches. **Exempt:** `create-billing-products`
(writes to Stripe, keeps its own refuse-live-without-`--live` guard),
`build28-prepare-images` (local image generation).

Residual risk, stated honestly: browser-driving capture scripts (build34 etc.)
can still write through the logged-in app UI if pointed at prod with prod
credentials — the guard can't see writes the page itself makes. They default to
loopback and need a prod-built client + prod creds to do damage; accepted and
documented rather than pretending the guard covers it.

### 1.2 Second layer: confirmation flag + pre-overwrite logging

`scripts/lib/prodGuard.js`:
- `writerBase(loopbackDefault)` — refuses a non-loopback default at require
  time (a writer can never ship a prod default again); a non-loopback `BASE=`
  additionally requires `--i-know-this-is-prod` or the script exits 1 before
  any request. **A typo in BASE is no longer enough to write to prod.**
- `writerDbUrl()` — same two layers for direct-DB scripts.
- `logOverwrite(label, current)` — prints the current state and, for remote
  targets, saves a JSON snapshot to `docs/prod-write-backups/` BEFORE the
  write. Wired into every overwrite site in the five overwrite-class scripts
  (seed-build50-demo ×2, seed-build54-demo ×2, fix-build54-demo-photos,
  migrate-build51, migrate-build51b). The saved bytes were the whole recovery
  last time; now they exist by construction, not by luck.

Enforced by `tests/script-guards.test.js` (276 asserts, in run-all.sh): the
classification is total, guarded writers have no BASE bypass, read-only scripts
are verifiably read-only, and the guard's semantics (refusal without flag,
loopback needs no flag, snapshot-on-remote-only) are unit-tested in-process.
Verified live: `BASE=<prod> node scripts/seed-build45-asks.js` → exit 1, no
request issued.

### 1.3 Did a prod-defaulting script ever run bare and silently overwrite something?

Evidence examined: all 38 Claude Code session transcripts in this environment
(grepped for every invocation of the historically prod-defaulting scripts),
shell history (empty for these — tool-run commands don't land in zsh history),
committed export artifacts in `docs/`, and the audit docs.

Findings:
- **Every bare invocation found maps to a documented, deliberate prod
  operation**: `fix-demo-finance-ledger` (BUILD-10, artifact
  `docs/demo-finance-orphans-removed-2026-07-18.json`),
  `dedupe-finance-gift-stamps --apply` (BUILD-23, artifact
  `docs/finance-gift-stamp-dupes-removed-2026-07-19.json`),
  `migrate-build51-theme-assets` + `migrate-build51b-impact-photos` (BUILD-51,
  documented migrations of the two prod demo orgs), `seed-build50-demo`
  (BUILD-50's documented 20/20 prod seed on 2026-08-13), and the known
  2026-08-15 incident run (repaired same night, byte-identical asset restore
  proven by the identical content-addressed `pa_` id).
- **`consistency-audit` ran bare against prod many times — read-only by
  design**, no writes to find.
- **What I cannot rule out**: theme/settings PUTs before BUILD-51 left no
  audit rows (fin_audit_log covers finance only; portal_audit_log covers the
  donor portal, not staff-side settings), and this environment has no prod DB
  credentials to sweep server-side history. So "no unnoticed overwrite" rests
  on the transcript sweep being complete for THIS machine. Any run from another
  machine or a deleted session would be invisible to it. Honest verdict:
  **no evidence of an unnoticed overwrite, and the evidence is good but not
  exhaustive.**

### 1.4 Recovery reality: there is no backup, and what one would take

Stated plainly: **the 2026-08-15 recovery depended on an incidental local copy
of the banner bytes saved during diagnosis — not on any backup, versioning, or
undo.** Portal assets are content-addressed and reference-count PRUNED on
replace: the moment a theme PUT lands, the old asset's refcount hits zero, the
row/S3 object is deleted, and the public URL 404s. There is no server-side way
back. The same is true of every JSONB settings row (portal_settings,
portal_pages draft/published, impact_updates): a PUT is a destructive
overwrite with no prior-version row anywhere.

What an undo would take, scoped (NOT built tonight — each is its own reviewed
change):
- **Soft-delete window on pruned assets (cheapest, highest value):** instead of
  deleting a zero-reference `portal_assets` row / S3 object at replace time,
  stamp `pruned_at` and let the existing 5-min tick hard-delete after N days
  (30?). Restoring the incident banner would have been one UPDATE. Cost: a
  `pruned_at` column, a sweep clause, and the S3 delete moves into the sweep.
  Storage cost ~zero at current scale. No API surface change.
- **Versioned settings rows (medium):** an append-only `portal_settings_versions`
  (org_id, snapshot JSONB, actor, created_at, keep last N) written inside the
  PUT handler. Covers theme/colors/display fields — the incident class.
  Portal pages already have half of this (draft vs published); themes have
  nothing.
- **Bucket versioning (belt-and-braces):** Tigris supports S3 object
  versioning; enabling it on `steward-portal-assets` is a dashboard/API toggle
  plus a lifecycle rule to expire old versions. Covers asset BYTES only (not
  DB-fallback rows, not settings), and restore is manual S3 surgery — a
  complement to the soft-delete window, not a substitute.
- **What a real backup story is NOT**: Supabase PITR/nightly dumps exist as a
  platform feature but are org-wide disaster recovery, not a per-row undo —
  restoring one org's banner from PITR would mean a full clone + manual copy.
  Don't count it as the answer to this incident class.

Recommendation (for review, not done): the soft-delete window on asset prune +
settings versioning for portal_settings. Together they make the incident class
recoverable in minutes with no new infrastructure.

---

## Part 2 — portal editor layout (BUILD-55)

The root defect: the editor rendered each widget through its OWN single-widget
`PageRenderer`, and deliberately never loaded the published page's grid CSS —
so "Desktop" was the phone column with a different label; the real `.pt-widgets`
two-track grid could never form.

What shipped (`client/src/pages/PortalEditor.jsx` + a `decorate` seam on
`PageRenderer` in `PortalWidgets.jsx`):
- **Desktop = the real render.** One `PageRenderer` over all widgets, with the
  published page's own layout rules mirrored into an editor-scoped style block
  (`.pe-wrap` ladder 860 → 1140 ≥1280px → 1360 ≥1720px; `.pt-widgets`
  two-track grid ≥1280px — mirrored from Portal.jsx's PortalStyles, noted to
  keep in lock-step). Edit chrome (select outline, label, ↑ ↓ ✕, drag) is
  injected per widget INSIDE its grid cell via the new `decorate(w, node)`
  render prop, so grid placement is untouched. Verified at 1440 (grid
  `1fr 1fr`, wrap 1140px) and 2560 (wrap 1360px — the canvas scales up, it
  doesn't pin).
- **Phone = a phone.** 390px frame with an ink bezel, its OWN internal scroll,
  centered both axes in the canvas (`margin: auto` — never clips when the
  viewport is short), height fills the available space, labeled
  "Phone · 390px — how donors arriving from email see it".
- **The widget library is no longer a permanent ~25% rail.** "+ Add widget" in
  the top chrome opens it as a temporary left panel; adding a widget closes the
  panel and selects the new widget (its options open immediately).
- **The options panel renders beside the canvas only while a widget is
  selected** — click a widget, edit its fields there; Done collapses the panel
  and the canvas reclaims the space.

Verified by `scripts/build55-capture.js` (23 asserts + screenshots in
docs/build55/): phone centering + no permanent rail, desktop grid + both
ladder steps, options-beside-canvas open/close, library open/close, and the
Part 3 assertions below. `tests/portal-page.test.js` (44) and
`scripts/build54-capture.js` (20) still green — the editor's safety contract
(sample-donor-only, fixed API allowlist, phone default) is unchanged.

## Part 3 — three fixes

**Fix 10 — Programs & funds cards now carry per-fund designations, and the
designation actually LANDS.** Two layers were broken, one visible, one not:
- Visible: every card's Give linked to the bare `/give/<slug>` — identical to
  the generic Give button. Now each card links `/give/<slug>?fund=<its id>`,
  and Donate.jsx preselects that fund (validated against the org's exposed
  funds; a page-level fund still wins).
- Invisible, and worse: **the Stripe webhook DROPPED `metadata.fund_id`
  entirely** — `/donate` has stamped the chosen fund into charge metadata
  since the fund selector existed, but the gift INSERT never included
  `fund_id` and the ledger stamp always routed to the org's first unrestricted
  fund. So even a donor who used the giving page's own fund selector produced
  an UNdesignated gift. Fixed: the webhook validates the fund is org-owned
  (foreign/garbage → null, never cross-org), writes `gifts.fund_id`, and the
  ledger stamp routes to the designated fund (legacy first-unrestricted only
  when no designation). This is what feeds the fund-targeted impact matcher.
- Scoped gap (not fixed tonight): a RECURRING gift's renewal charges can't
  carry the fund — `recurring_subscriptions` doesn't store a fund the way it
  stores campaign/page attribution (stamped at checkout.session.completed).
  The first charge and every one-time gift designate correctly; a sub's
  renewals fall back to undesignated. Same shape as the campaign-renewal fix
  that column got — a small reviewed follow-up.

**Fix 11 — manual sort order.** The funds widget's `fundIds` array IS now the
display order end to end: the published-page resolver returns funds in
fundIds order (was: DB order, effectively alphabetical — Gala Reserve led),
the editor preview mirrors it, and the options panel lists chosen funds with
↑ ↓ reorder controls ("the first fund leads the section"). An org can lead
with General Operating.

**Fix 12 — the impact feed placeholder.** Verdict: it was the sample-donor
substitution working as coded — the editor's `ctx.me` (Sam Sample) always won
the widget's `me.impact` precedence, so the placeholder rendered even with
real published updates. Intentional code, wrong outcome: the org couldn't see
what donors see. Fixed on both sides: the editor now fetches the org's REAL
published updates (`/impact-updates` — org content, not donor data; it joined
the pinned API allowlist in tests/portal-page.test.js as a reviewed change)
and renders them in the impact widget, with the labeled sample entry only as
the nothing-published-yet fallback. Widget precedence became "donor matches
first, resolved org-wide otherwise" — which also fixes a real live-portal
quirk: a signed-in donor with zero matched updates used to see NOTHING where
the public page showed org-wide news; they now see the org-wide feed. The
public page resolution is unchanged (published org-wide only, drafts never).

All three pinned by `tests/portal-designation.test.js` (23, in run-all.sh):
manual order beats alphabetical through draft → publish → public resolution;
distinct per-card fund ids; a signed webhook with a fund designation lands on
the gift row AND its ledger stamp; foreign-org fund ids rejected; undesignated
behavior byte-compatible with before; the client chain + editor + precedence
source contracts.


---

## What I'd still be nervous about (the honest list)

1. **The editor's desktop CSS is a MIRROR, not a shared source.** `.pe-wrap`/
   `.pt-widgets` rules are copied from Portal.jsx's PortalStyles with a
   keep-in-lock-step comment — no automated parity check. If the published
   page's ladder or grid changes, the editor silently drifts until someone
   notices. A small source-guard (assert the two style blocks agree) would
   close it.
2. **The impact-precedence change touches the LIVE signed-in portal**, not
   just the editor: a donor with zero matched updates now sees the org-wide
   feed where they previously saw nothing. I believe it's an improvement (the
   public page already showed that content), and it's documented + tested —
   but it's a donor-visible behavior change that shipped without a human
   looking at it on prod.
3. **Recurring renewals still can't carry a fund designation** (no fund column
   on recurring_subscriptions). A donor who starts a monthly gift from a fund
   card gets a designated first charge and undesignated renewals.
4. **The guard can't see browser-driven writes.** A Playwright capture script
   pointed at prod with prod creds writes through the app UI regardless of
   prodGuard. All such scripts default loopback and are classified, but the
   protection there is convention + classification, not enforcement.
5. **There is still no backup/undo for portal assets or settings rows.** Part
   1.4 scopes the fixes (soft-delete prune window + settings versioning);
   until one ships, the next overwrite-class accident is again unrecoverable
   unless someone happened to save bytes first.
6. One transient `portal-page` failure (43/1) appeared in an early subset run
   and never reproduced — three subsequent runs including the full battery
   were green. Most likely leftover scratch-DB state from this session's
   tooling; noting it because unexplained one-offs deserve a line.
