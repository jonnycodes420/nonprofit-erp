# BUILD-57 — recurring giving, and the first walk of the whole chain

Run on auto, 2026-08-16. Parts landed in order through the full gate.
Commits: Part 1 `2ed134f` (SHA-verified live both sides) · Part 2 `7ad1755` ·
Part 3 + report: see final commit.

## Part 1 — the staff recurring surface (LIVE)

Built from BUILD-57's own embedded decision table because
**`BUILD-53-staff-recurring.md` does not exist anywhere** — not in the repo,
not in git history, not in any session transcript (only references to it as
"queued" from other builds' briefs). Nothing could be "deliberately dropped"
from a spec that was never delivered; `BLOCKED-build57.md` has the search
trail. What shipped:

- **Fundraising → Recurring Giving**: movement summary (MRR, month-to-date
  waterfall over the append-only `recurring_change_log`, 12-month retention
  with the M+R Benchmarks 2026 71% figure cited with its source), the
  at-risk queue FIRST and visually distinct, the full roster (donor, amount,
  frequency, fund, next charge, start, total-given-on-subscription via new
  `gifts.recurring_subscription_id`, status), per-row actions behind one menu.
- **Home → Today | Recurring tabs**: the Recurring tab is exceptions only
  (cards just failed, about to lapse, pending proposals, anniversaries) +
  one button into the full page. Not a second roster.
- **The action rule, enforced**: money-moving changes (create/amount/
  frequency/card) are donor-completed proposals (hash-at-rest tokens, 14-day
  expiry, one resend, supersede-on-duplicate); pause/resume/cancel/fund are
  staff-direct; cancel is never write-gated. Every staff change fires an
  UNSUPPRESSIBLE donor email — tested against the kill-switch AND the
  suppression list, not just "it fires".
- `tests/recurring-surface.test.js` (90) in run-all; org-blindness battery
  grew the three new routes in the same commit. Captures:
  `docs/build57/part1/`.
- Deviation noted: a proposal RESEND extends the 14-day expiry from the
  resend (a resent link that dies a day later would be user-hostile).

## Part 2a — the real-Stripe drill (the build's most valuable output)

`docs/build57/stripe-drill/DIFFERENCES.md` is the full list. The short
version: **three builds of recurring plumbing were proven against a mock that
lied in seven load-bearing ways.** On real Stripe, no recurring charge ever
recorded a gift (subscription PIs carry no email/metadata), the entire
failed-card recovery family dead-guarded on 2025+ event shapes
(`invoice.subscription` moved; `pi.invoice` removed), donor/staff repricing
was impossible twice over (product_data rejected; Checkout products are
inactive AND immutable), the card-update completion never executed (a
stripe-node options-position bug sent `stripeAccount` as a query param), and
the recovery thank-you was starved by event ordering. All seven fixed and
pinned in `recurring-surface` §6 with real payload shapes; then the full
lifecycle ran clean against real Stripe: create → designated first charge →
renewal-shaped charge (designation intact on gift + ledger) → increase →
decrease → pause → resume → real card failure → dunning → card-update
Checkout → recovery → cancel → refund reversal → replay no-op →
out-of-order no-op → server-down redelivery exactly-once.

**Prod-relevant caveat:** whether prod currently receives old- or new-shape
events depends on the dashboard webhook endpoint's pinned API version —
step 1 of `BLOCKED-stripe-live-drill.md` has Jonathan check it. Either way
the normalizers now accept both.

## Part 2b — the hostile import (fix one, catalogue the rest)

The BUILD-54 batch-abort collision is FIXED at the root: every bulk-import id
mint (donors, gifts, interactions, ledger stamps, both import routes) now
carries full uuid entropy (`d_` + 32 hex); pinned in import-combined.
The 1,225-donor / 2,420-gift hostile workbook then ran UNATTENDED through the
real browser surface. **14 findings catalogued, not fixed** —
`docs/build57/import/import-findings.json` + step screenshots. The ones that
would fire in a pilot's first week, ranked:

1. **The RECOMMENDED menu entry ("Import + History") opens the OLD
   CombinedImport component** whose multi-sheet picker forces one sheet — the
   "Import both — donors + their gift history" magical path exists only
   behind "Import donors only". A pilot following the recommended path with
   the most common two-sheet workbook never sees the linked import.
2. **"Donor Email" is not recognized as an email column** (`isEmailHdr`
   anchors to `^email$`), so Import-both silently fell back to LINK BY NAME —
   name variants then mint duplicate minimal donors and split history.
   "Donor Email" is the most common gift-export header there is.
3. **`external_id` never reaches the DB through Import-both** — zero of 2,414
   gifts carried it despite a Transaction ID column on every row; the F-4
   cross-run idempotency contract never engages through this surface.
4. **Deceased / Do-Not-Contact columns are silently discarded** — a pilot org
   could solicit a deceased or do-not-solicit donor from day one.
5. **Non-UTF8 (windows-1252) CSVs import as mojibake** — "José Muñoz" is
   permanently stored as "Jos� Mu�oz", no warning.
6. Month-year strings ("Jan-15") parse as the wrong decade (2001-01-15);
   refund/negative rows are silently dropped (totals overstate); malformed
   emails stored verbatim; formula-injection names stored verbatim (export
   guard still escapes them); future/epoch dates accepted unflagged.
   Honest behaviors confirmed: same-day twins all import + are reported;
   Excel serial dates parse correctly; orphan gifts mint minimal donors;
   re-import dedupes by email.

## Part 2c — the lifetime-total discrepancy: CAUSE FOUND, LABELED

Confirmed on prod org_creo: **James Okafor is the exact `$15,200 · 5 gifts`
vs `$12,500 · 2 gifts` screen.** Cause is neither soft credit nor household
roll-up: the `donors.total_giving`/`gift_count` COLUMNS carry giving that has
no itemized gift rows — the deliberate aggregate-import design (the same
reason Top Donors' lifetime scope reads the column). Four demo donors have
column totals beyond their rows. The fix is labeling, since inventing dated
gift rows to reconcile would fabricate history: the profile Overview now
carries "Lifetime includes $2,700 recorded as an imported total — giving that
predates Steward and was never itemized," and the Gifts tab total line
carries the same gap inline. Asserted by the capture script against a
column-beyond-rows fixture donor.

## Part 2d — eyes on the live portal

`docs/build57/prod/` — /giving signed-out, org_creo portal signed-out, give
page, at 390 + 1440, all clean (no overflow, no error junk). **Flags:**
- The donor-facing give page headline reads "Give to **CREO Arts (Demo)**" —
  the STAFF-side org name, not `portal_settings.display_name`. The
  white-label name doesn't reach `/give`.
- Fund cards with per-fund Give links (the BUILD-55 chain) render on the
  donor-authed portal page, which a read-only capture can't reach — the
  signed-in portal + signed-in /giving dashboard still need a human eyeball
  (or the Renee magic-link recipe) on prod.

## Part 3 — the walk

All 17 steps walked in one continuous sequence against the local stack wired
to REAL Stripe test mode — full per-step record + screenshots in
`docs/build57/walk/WALK.md`. What worked end to end, first time ever pulled
in one motion: signup → review gate (it correctly REFUSED with an empty EIN
registry) → approval → 1,227-donor unattended messy import → editor theme +
page + publish (contrast guard did its job) → impact update → campaign →
cold designated $60 gift via real Checkout → auto-receipt → donor account +
verified-email link (history appeared, only hers) → designated recurring →
real renewal (designation intact) → staff-proposed increase completed by the
donor with the notification proven unsuppressible → real card failure into
the Part 1 at-risk queue → staff resend → real card-update Checkout →
recovery → second-org follow → org-blindness byte-identical → year-end $110
= hand math on both staff and donor sides.

**Walk findings, ranked by pilot-first-week impact** (details in WALK.md):

1. **W-3** — an org born through `/network/signup` never runs `seedOrgData`:
   no chart of accounts, so EVERY gift's ledger stamp silently no-ops and
   Finance reads $0 forever for this whole org class. The "one gift → one
   ledger row" invariant quietly doesn't hold for real-signup orgs.
2. **W-2** — the approved portal-tier org's first login is an error-styled
   "Failed to connect" dead end, and none of the portal tier's advertised
   capabilities (gift recording, receipts, impact updates, the portal
   editor) are reachable in the UI at that tier — the APIs allow it, no
   surface calls them.
3. **W-4** — the failed-card recovery email honors the MARKETING suppression
   list and still logs `dunning_sent`: a donor who ever unsubscribed is
   silently unrecoverable while the log claims otherwise. Needs the same
   transactional-vs-marketing decision BUILD-57 made for staff-change mail.
4. **W-6** — the gift officer's day view rendered EMPTY on the org's most
   eventful donor day: auto-receipting marks gifts acknowledged, so the
   thank bucket treats a legal receipt as a personal thank-you, and the
   thank-you tasks that DO exist aren't surfaced by the day view.
5. **W-1** — `/stripe/connect` marks `stripe_connected=true` at LINK
   creation; the network-approval gate reads that flag, so a reviewer can
   approve an org whose onboarding never finished (gate should check
   `charges_enabled` live, as it does the EIN).
6. **W-5** — proposal email subject doubles the org name (cosmetic).
7. **W-7** — "thank-you to undefined" task titles on the
   subscription-resolved gift path (fixed inline — trivially safe, my own
   new §2a code; ledger vendor name fixed with it).

## §worry

What I would not bet on, plainly:

1. **Which event shapes prod actually receives.** The drill ran on CLI API
   version 2026-04-22; prod's webhook endpoint has its own pinned version I
   cannot see from here. The normalizers accept both generations, but the
   seven §2a bugs mean prod's recurring/recovery machinery has NEVER been
   exercised by a real renewal or a real failure — the first real sustainer
   month in prod is still a first. The live drill
   (`BLOCKED-stripe-live-drill.md`) is the only thing that converts this from
   argument to evidence. I would not approve a real nonprofit before it runs.
2. **The mock is still load-bearing everywhere else.** I fixed what the drill
   TOUCHED. The billing webhook (`/billing/webhook`), platform subscription
   lifecycle, and Connect onboarding flows were not drilled and still rest on
   mock-era assumptions of the same vintage that just produced seven bugs.
3. **Import is still the highest-risk surface.** The collision is fixed, but
   findings 1–5 of §2b (recommended path bypasses the magical import,
   "Donor Email" defeats email linking, external IDs dropped, deceased/DNS
   flags discarded, mojibake) are exactly first-week pilot wounds, and none
   are fixed. The name-fallback linking (finding 2) quietly SPLITS donor
   histories — a data-integrity wound the org discovers weeks later, which is
   the worst kind.
4. **The movement waterfall's involuntary-churn figure is only as good as
   `subscription.deleted` arriving.** If a webhook outage eats that event,
   a card-failure loss never lands in the log and the waterfall undercounts
   involuntary churn with no reconciliation sweep to notice. There is no
   nightly Stripe↔DB recurring reconciliation; after the import lesson I'd
   rank that the next honest hardening.
5. **The 12-month retention figure starts honest but thin** — with cohorts
   this small (single digits for a pilot's first year), the number will swing
   wildly and sit next to a 71% sector benchmark; a sustainer manager could
   read noise as signal. The null-below-cohort-size guard only fires at zero.
