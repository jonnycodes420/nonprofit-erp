# BUILD-44 — overnight wiring sweep: FINDINGS (2026-08-07)

Tests only — **nothing below was fixed**; each finding is encoded as *current
behavior* in a committed suite (with a `FINDINGS` comment at the assertion),
so every one is reproducible by running the named suite and will announce
itself the moment someone fixes it (the encoded assertion will fail and force
a deliberate manifest/matrix update). Ranked by severity.

---

## F-1 · HIGH — read-only (lapsed) orgs can still perform Team-layer WRITES

**Suite:** `tests/permissions-matrix.test.js` (rows tagged F-4 in-code) ·
**Repro:** org `plan='team'`, `subscription_status='trial_expired'` → admin
token → `PATCH /donors/:id/assign`, `PATCH /donors/bulk-stage`,
`POST /donors/:id/score` → **200**, state changes.
**Expected:** 402 `subscription_required` — `getOrgAccessState` says
read_only means "no writes."
**Actual:** five routes carry `requirePlan("team")` but **no
`checkWriteAccess`**: `/donors/:id/stage`, `/donors/:id/assign`,
`/donors/bulk-stage`, `/donors/bulk-assign`, `/donors/:id/score` (verified at
source, server.js:3285–5408). The BUILD-19/BUILD-31 passes added the
plan gate to these routes but the write gate was never layered on.
**Blast radius:** a lapsed org can't move money (gifts/campaigns/grants all
402 correctly — the matrix proves it) but can keep reorganizing portfolios,
stages, and scores forever. Contradicts the documented read_only contract.
**Fix shape (post-review):** add `checkWriteAccess` to the five routes — one
middleware token each; the matrix rows then flip `"open"` → `402` in the same
PR.
**Related (Low):** `POST /auth/invite` is also write-ungated — a read_only
org can invite new users (seat-limited). May be deliberate (rejoining after
reactivation?) — decide, then encode.

## F-2 · MEDIUM — a failed notification send is lost FOREVER (no retry, no surfacing)

**Suite:** `tests/notify-delivery.test.js` ("outage" block). **Repro:** point
`RESEND_BASE_URL` at a 500-ing sink → assign a task to a teammate → the send
is attempted once, fails, is **never retried**, and nothing anywhere surfaces
the failure. Worse: `notifyUserOnce` **reserves the `notification_sends`
dedup row BEFORE sending**, so even a later manual re-trigger of the same
event dedups to silence. This is the exact class behind "the B4 alert that
silently never landed."
**Expected:** retry with backoff, or at minimum release the reservation on
send failure + surface a failed-sends count somewhere ops-visible.
**Actual (deliberately good part):** the send failure never fails the
triggering action — correct; the gap is purely delivery robustness.
**Fix shape:** reserve → send → on failure DELETE the reservation (the
UNIQUE key already makes a concurrent duplicate safe) + a retry sweep on the
existing 5-min tick; `/health` gains a `failedSends` counter.

## F-3 · MEDIUM — no idempotency on manual gift entry: a double-tap records the gift twice

**Suite:** `tests/concurrency2.test.js` §4. **Repro:** two identical
`POST /donors/:id/gifts` racing (double-clicked Save, phone retry on flaky
wifi) → **two gifts**, donor total doubled, two ledger stamps. Everything is
*internally consistent* (each gift stamps once — the BUILD-21/43 invariants
hold), but the money is double-counted from the user's point of view.
Online gifts are immune (`stripe_payment_id` dedup); manual entry has no
equivalent. The pledge half behaves well: the pledge fulfills exactly once.
**Fix shape:** client-generated idempotency key on the gift form POST +
a short-window UNIQUE, or a server-side duplicate-warning (same donor,
amount, date within N seconds) — product decision on which.

## F-4 · LOW-MEDIUM — import silently collapses same-day same-amount gift twins

**Suite:** encoded in `tests/state-diff.lib.js` (fixture comment) — found
when 5 of 5,738 fixture gifts vanished. **Repro:** import a file where one
donor has two gifts of the same amount on the same date → one gift lands.
Real-world case: a donor genuinely gives $500 twice on 2021-12-15 (two
checks); the import keeps one and reports no warning. The idempotent-re-run
design causes it (gift dedup key = donor+amount+date).
**Fix shape:** count duplicate (donor,amount,date) rows within ONE file and
import them all (intra-file multiplicity is real data; cross-RUN dedup is
what idempotency needs), or surface a "N same-day duplicates collapsed"
warning in the import summary.

## F-5 · LOW — pledge payments fulfill the WHOLE pledge regardless of amount

**Suite:** `tests/state-diff.manifests.js` (A9b comment) +
`state-diff.test.js`. **Repro:** $1,200 pledge → $400 gift with `pledgeId` →
pledge status `fulfilled`, `pledged` drops by the full $1,200 everywhere.
There is no partial-payment tracking; the model is single-payment. Perhaps
deliberate — but a fundraiser recording installment #1 of 3 will read
"fulfilled" as wrong. Decide and either document in-product (helper text on
the pledge form) or build installments later.

## F-6 · LOW — no "pause" state for recurring gifts

**Suite:** `tests/state-diff2.test.js` B11 (comment). Statuses are
`active/past_due/recovering/recovered/canceled` — a donor asking to "pause
my gift for the summer" can only be canceled and re-created. Product gap,
not a bug.

## F-7 · LOW — simulate-path notifications can double-email one person for one gift

**Suite:** `tests/state-diff2.manifests.js` B2b (comment). Under
`POST /workflows/simulate`, the major-gift alert's task-assignment email uses
a `taskassign:<taskId>` event key while instant-thanks uses the gift key —
the officer gets 2 emails for one simulated gift. The REAL webhook path
collapses to one (pinned by `notifications.test.js`). Ops/test surface only,
but the key asymmetry is worth knowing.

## F-8 · INFO — Week-in-Review previews the COMPLETED week

Same-week actions never appear in `/digests/preview` (BUILD-43 discovery, now
frozen into every manifest). By design (the digest ships when the week
completes) — but anyone demoing "look, my gift shows in Week in Review" on
Sunday will be surprised. Know it before the meeting.

## F-9 · INFO — missing reversal routes (known, consolidated)

No restore-from-trash for donors, no fund delete, no remove-user
(`BLOCKED-demo-org-officers.md`). Each makes some state one-way that
shouldn't be.

---

## What the sweep PROVED (the good news, equally load-bearing)

- **Empty org is clean**: every screen at 390px+1440px renders with zero
  NaN / Invalid Date / undefined / Infinity, zero page errors, and the
  retention card does NOT fabricate a rate (`empty-states.test.js`, 20/20).
- **Screens match the API**: 22/22 rendered figures equal API values at both
  widths, in both money formats (`presentation-wiring.test.js`).
- **The B-series manifests hold exactly** (101 asserts): grant award stamps
  the ledger once and un-award reverses it byte-for-byte; closing keeps the
  booking; goal roll-ups never double-count a child; branding moves ZERO
  numbers; household combined = Σ hard credit; year-end regenerate
  supersedes to exactly one active statement; all five recipes fire once and
  a dedup-key refire moves NOTHING org-wide.
- **Races hold**: parallel gift edits leave donor total == gift == ledger
  stamp every time (the BUILD-43 sync survives contention); parallel imports
  of the same file land each donor/gift exactly once; parallel reassignment
  is always coherent; notification/digest reservations hold.
- **The permissions matrix is green as encoded** (86 asserts incl. both
  cross-org 404s and the data-hostage export rule).

## Remaining work (honest)

Not covered tonight: a browser affordance sweep per role (staff UI showing
no admin controls is asserted only via source greps + capture-script gates);
household merge-vs-split as first-class entities beyond member add/remove;
sequences/events surfaces (deprioritized product areas); Stripe billing
lifecycle (covered by billing.test.js, not re-swept here).

## The one-paragraph verdict

What I'd still be nervous about, in order: **F-1** is the only thing here I'd
call wrong-wrong — it contradicts the product's own written contract and a
board member could phrase it as "so lapsed customers can still edit?" — but
it moves no money and no donor data leaves the org. **F-2** is the one most
likely to bite silently in production, because its failure mode is the
absence of an email nobody knows to expect. **F-3** is the one most likely to
bite a REAL fundraiser (double-tap on conference wifi), though the wiring
test proves the damage stays consistent and visible (both gifts render
everywhere — nothing hides). Beyond the findings, my residual nervousness is
concentrated where the harness can't see: real Stripe (live-mode webhooks,
Connect edge cases), real email deliverability, and the browser at true
phone width under a real thumb — the presentation suite checks numbers, not
feel. The data core itself — every number agreeing with every other number
across 189 manifest-driven asserts at 1,530-donor scale, twice over — is the
part of this product I would now defend without hedging.
