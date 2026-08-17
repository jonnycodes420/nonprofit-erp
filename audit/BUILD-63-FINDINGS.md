# BUILD-63 — ship BUILD-62, then close the class behind it

BUILD-62 fixed one instance of a class: a webhook handler reading state a
*sibling* webhook writes, delivered concurrently. This build ships that fix and
then asks the question it implies — **where else does the same shape exist?** —
and answers it with out-of-order regression tests where money can move.

---

## PART 1 — SHIP IT

BUILD-62 (the redacted `7ac3448`, single commit) went through the full gate:
pre-push battery green (99 suites), pushed to `main` (`12bd1ed..7ac3448`), CI
`test` job green, and **both surfaces SHA-verified live** — `deploy-railway`
SUCCESS (`/health.buildSha == 7ac3448`) and `deploy-vercel` SUCCESS (its "verify
live site serves this commit" step green; note `curl` can't verify the frontend
directly because `www.stewardapp.dev` sits behind Vercel's bot-challenge
"Security Checkpoint" — the CI job's own SHA-verify is the check).

BUILD-63 then shipped on top: **`fbe40ba` (the manifest + the three race fixes)
is SHA-verified live on both surfaces** (deploy-railway + deploy-vercel both
SUCCESS), and **`4802bba` (the reconcile-blindness hardening) is the current
`main` HEAD**. Its `deploy-railway` was cancelled once (queued behind fbe40ba's
slow Railway build, dropped by the `deploy-main` concurrency group); the hardening
rides the next `railway up` (which deploys the full working tree). **Deployed SHA
chain: `7ac3448` → `fbe40ba` (live) → `4802bba` (HEAD, backend deploy re-triggered
by the final docs commit).**

**Live `/health` readings confirm the build works in production** (on `fbe40ba`):
- `webhookSubscriptions: {missingCount: 2, checked: true}` — the prod
  manifest-vs-endpoint diff ran and found **exactly the 2 handled-but-unsubscribed
  events** this file lists (`charge.dispute.updated` on donation,
  `invoice.payment_succeeded` on billing). Part 2 works end-to-end in prod.
- `reconciliation: {unrecordedCharges: 0, checkedAt: 2026-08-17T20:42:28Z, …}` —
  the guard re-ticks in prod. `accountsErrored` appears once `4802bba` deploys
  (see the post-ship observation below — that field is what tells us whether the
  0 is trustworthy or the guard is blind).

Note on the push: the first attempts were correctly blocked — the *public* repo
would have received the live Stripe object ids (account / customer / subscription
/ event / endpoint) and a donor email that the BUILD-62 findings quoted. Those
were redacted to descriptive placeholders (the operational ids were handed to
Jonathan directly), and the push then went through. Entrusted operational
identifiers do not belong in a public commit — a real finding in its own right.

---

## PART 2 — THE EVENT MANIFEST

BUILD-58 built `charge.refunded` reversal and `charge.dispute.*` handling, tested
them, and shipped them into a production endpoint that subscribed neither —
working code wired to nothing, the same class as the race. Now the class is
closed, not the two instances:

- **`stripeEvents.js`** declares, per endpoint, every Stripe event type the
  handler dispatches on (`DONATION_WEBHOOK_EVENTS`, `BILLING_WEBHOOK_EVENTS`) plus
  `webhookEventDiff()`.
- **`tests/webhook-manifest.test.js`** keeps the manifest honest against the
  handler: it scans the `/stripe/webhook` and `/billing/webhook` blocks in
  server.js, extracts every `event.type === "…"`, and asserts set-equality with
  the manifest BOTH ways — a handler `case` with no manifest entry fails, and a
  manifest entry with no `case` fails. The manifest cannot drift from the code.
- **`scripts/check-webhook-subscriptions.js`** (READ-ONLY, `--i-know-this-is-prod`,
  classified `PROD_READONLY` in `script-guards`) diffs the manifest against the
  LIVE endpoint's subscribed events. It reports; it never modifies. Loopback/dry
  by default (prints the manifest, no Stripe contact).
- **`/health.webhookSubscriptions.missingCount`** surfaces the diff alongside the
  reconciliation counters, so a handler that grows a `case` nobody subscribed
  becomes visible rather than silent (refreshed at boot + hourly;
  `POST /admin/webhook-subscriptions/check` drives it on demand).

### The live diff (run `2026-08-17`, read-only) — a list Jonathan can act on in one pass

The donation endpoint config has changed since BUILD-62 (refund + dispute events
were added in the interim), and the precise diff shows the coarse fix subscribed
the *wrong* dispute sub-events:

```
── DONATION (Connect)  (/stripe/webhook) ──  api_version=2026-04-22.dahlia
   subscribed: payment_intent.succeeded, checkout.session.completed,
     invoice.payment_failed, invoice.payment_succeeded,
     customer.subscription.updated, customer.subscription.deleted,
     charge.refunded, charge.dispute.created, charge.dispute.closed,
     charge.dispute.funds_withdrawn, charge.dispute.funds_reinstated
   MISSING (handled, not subscribed):  charge.dispute.updated
   EXTRA   (subscribed, not handled):  charge.dispute.funds_reinstated
   EXTRA   (subscribed, not handled):  charge.dispute.funds_withdrawn

── PLATFORM BILLING  (/billing/webhook) ──  api_version=2026-04-22.dahlia
   subscribed: checkout.session.completed, customer.subscription.deleted,
     invoice.payment_failed, customer.subscription.created,
     customer.subscription.updated
   MISSING (handled, not subscribed):  invoice.payment_succeeded
   EXTRA   (subscribed, not handled):  customer.subscription.created

TOTAL handled-but-unsubscribed event types: 2
```

**Two real actions for Jonathan (Stripe dashboard):**

1. **Donation endpoint — ADD `charge.dispute.updated`.** The BUILD-58 dispute
   handler processes `created/updated/closed`, but the endpoint subscribes
   `created` + `closed` only. A dispute moving to `under_review` (an `updated`)
   won't reach us — the staff task's status won't refresh. Also OPTIONAL: remove
   `charge.dispute.funds_withdrawn` / `funds_reinstated` (subscribed, but the
   handler has no case — delivered then ignored; harmless noise).
2. **Billing endpoint — ADD `invoice.payment_succeeded`.** The billing handler
   marks the org's own subscription active + clears the grace window on a
   successful renewal invoice, but that event isn't subscribed — a renewal-success
   path rests only on `checkout.session.completed` + `subscription.updated`.
   OPTIONAL: remove `customer.subscription.created` (subscribed, not handled).

`/health.webhookSubscriptions.missingCount` will read **2** until these are
added, then drop to 0.

---

## PART 3 — WHERE ELSE IS THIS RACE?

I enumerated every place a `/stripe/webhook` handler reads state another handler
writes, and answered the three questions (opposite order · simultaneous on
different workers · retry after the other) for each. Three were genuine hazards
that can drop, duplicate, or misattribute money — fixed and pinned by
`tests/webhook-ordering.test.js` (reversed, simultaneous, re-delivered). The rest
are safe, with the reason stated.

### FIXED

**Race 1 — the BUILD-62 one (recorded here for completeness).** `payment_intent.
succeeded` reads the `recurring_subscriptions` row `checkout.session.completed`
writes. Fixed in BUILD-62 (donor resolved from Stripe's customer when the row
isn't there yet). Pinned by `recurring-surface` §6(e) and re-proven here under
all three orderings (Part 4 Q2).

**Race 2 (Fix A) — attribution lost on a failed FIRST charge.** If a brand-new
subscription's first charge DECLINES, `invoice.payment_failed` pre-creates the
`recurring_subscriptions` row on the fly — but with NO attribution (fund /
campaign / page / cover-fee). `checkout.session.completed`'s insert carries the
attribution but used `ON CONFLICT DO NOTHING`, so if the failure event won the
race the designation was lost **forever**, and every recovered renewal would then
attribute to nothing.
*Opposite order:* checkout-first is fine (it inserts with attribution; the later
failure UPDATE preserves it). *Simultaneous / failure-first:* was the bug.
**Fix:** when checkout finds the row already there, it backfills the still-null
attribution columns (`COALESCE`, never clobbers). Pinned:
`webhook-ordering` "Fix A".

**Race 3 (Fix B) — the recovery flip could DOUBLE-fire.** Both
`invoice.payment_succeeded` AND `customer.subscription.updated` fire on a recovery
and are DIFFERENT events (the `event.id` dedup can't cross them). Each did a
check-then-act (`SELECT status` → if `past_due` → `UPDATE status='recovered'` +
send thank-you + log 'recovered'). Under concurrency on two workers both could
read `past_due`, both flip, both send the donor a "you're recovered" email and
both log 'recovered' — a duplicate donor email and a double-counted recovered-$
figure. (The old code comment even *claimed* "exactly one can" — the check-then-
update didn't enforce it.) **Fix:** the flip is now a compare-and-swap —
`UPDATE … WHERE status IN ('past_due','recovering') RETURNING id` — and every
side-effect gates on the update returning a row. Exactly one wins. Pinned:
`webhook-ordering` "Fix B" (two events fired via `Promise.all` → exactly one
'recovered' log, one recovery event, one thank-you email).

**Race 4 (Fix C — detection) — a refund that raced ahead of its own gift.**
`charge.refunded` reverses the gift `payment_intent.succeeded` writes. Causally
the charge succeeds before it can be refunded, so the gift-recording event is
generated first and this is low-likelihood — but if `charge.refunded` is
processed before the (earlier-generated) PI event, it finds no gift to reverse,
the PI later records the gift, and a **refunded donation sits as a live gift**
that nothing catches (the reconciliation guard's forward pass skipped fully-
refunded charges). **Fix:** the reconciliation guard now flags a fully-refunded
charge that STILL has a live gift (`refunded_charge_with_live_gift`) — detection,
not a fragile handler-ordering change, because the refund genuinely cannot
reverse a gift that doesn't exist yet. Pinned: `reconciliation` Scenario 6.
(Same shape applies to `charge.dispute.*`←gift; disputes lag charges by days, so
it's even lower-likelihood — noted in §worry.)

### SAFE (and why)

- **`invoice.payment_succeeded` ← `checkout.session.completed` (the sub row).**
  If the invoice event arrives first (row absent), it no-ops (`existingRows.length`
  guard) — it records no gift (the PI handler owns that) and its only jobs
  (current-period-end sync, paused/past_due transitions) don't apply on a clean
  first charge. The period-end is re-synced by the next `subscription.updated`.
  No money impact.
- **`invoice.payment_failed`** self-heals: it INSERTs the row if absent, so it
  never depends on checkout having run. (Its attribution gap was Race 2 — fixed.)
- **`customer.subscription.updated` / `.deleted` ← the sub row.** Both guard on
  `existingRows.length`; deleted has an else-branch that still mirrors the donor
  status via `event.account`. An update before the row exists no-ops and is
  re-synced later.
- **Re-delivery of any single event** is idempotent: gifts on `(org,
  stripe_payment_id)` `ON CONFLICT DO NOTHING`; the recovery family on
  `recoveryEventAlreadyProcessed(event.id)`; the sub row on
  `(stripe_subscription_id)`; the change log 'created' only on a genuine insert.
  Re-proven under re-delivery in `webhook-ordering` (Q2) and `recurring-surface`
  §6(e).

---

## PART 4 — THE TWO SPECIFIC QUESTIONS

### Q1 — Is the one-time gift path affected by the same race? **No. Plainly: one-time donors were never at risk.**

A one-time Checkout gift produces `payment_intent.succeeded` and
`checkout.session.completed` too — but the one-time PI **carries its own
`receipt_email` / `metadata.donor_email`** (set from `payment_intent_data` at
`/donate`), so the PI handler resolves the donor from the event itself and records
the gift with NO dependency on the checkout event. (The handler's
`checkout.session.completed` block only acts on `mode:"subscription"` and
`mode:"setup"` — it ignores a one-time `mode:"payment"` entirely.) The race was
specific to a *subscription's first invoice-generated PI*, which is the only PI
that arrives empty. Pinned: `webhook-ordering` Q1 (a one-time PI with an email
records the gift with no checkout at all, and creates no subscription row). The
blast radius was recurring-first-charge only — not larger than reported.

### Q2 — Can the fix produce a duplicate? **No. Exactly one subscription row and one gift, under both orders and re-delivery.**

The fix resolves the DONOR from Stripe's customer and records the GIFT; it does
**not** create a `recurring_subscriptions` row (that stays
`checkout.session.completed`'s job, `ON CONFLICT (stripe_subscription_id) DO
NOTHING`). So:
- **subscription row:** created once by checkout (`ON CONFLICT DO NOTHING`) — one,
  whichever order.
- **gift:** inserted by the PI handler on `(org, stripe_payment_id)` `ON CONFLICT
  DO NOTHING` — one, even on re-delivery.
- **donor:** the resolve-or-create runs under a per-`(org,email)` advisory lock —
  the PI-fallback create and the checkout create can't split into two.

Proven exhaustively in `webhook-ordering` Q2: PI→checkout, checkout→PI,
`Promise.all` simultaneous, and re-delivery of both — every case asserts exactly
one gift, one sub row, one donor.

---

## PART 5 — POST-RECOVERY VERIFICATION FROM PRODUCTION DATA

Jonathan recovered the first $1 (re-delivered the dropped
`payment_intent.succeeded` to the live endpoint; the deployed fix + the now-
existing subscription row recorded it — no re-charge). Verified from prod DATA,
not from word — **the whole chain, clean and un-duplicated**:

| Check | Result (read from prod, 2026-08-17) |
|---|---|
| Gift row | `g_76da4688` · $1 · `stripe_payment_id pi_3U5Ugz…` · linked `recurring_subscription_id rsub_eebec117` — **exactly one** |
| Ledger stamp | one row · `Online gift via Stripe` · `source=online` · `gift_id=g_76da4688` (the "one gift, one stamp" invariant holds) |
| Donor totals | `$1,300 → $1,301` · `5 → 6 gifts` · last gift `2026-08-17 $1` |
| Subscription link | roster `rsub_eebec117`: `totalGiven 1`, `linkedGiftCount 1` (were 0/0) |
| Fund designation | none — the drill's first checkout carried an empty `fund_id` (Part 0), so nothing to carry; not a defect |
| Tax receipt | **`#2026-00010` · $1 · type gift** (the receipt counter advanced correctly past the year-end `#2026-00009`) |
| Receipt email | `sent_to xjca2006@gmail.com` · `sent_at 2026-08-17T19:37:53Z` (BUILD-58: `sent_at` only after real delivery) |
| Duplicate? | **none** — one gift dated today, `gift_count 6`, one ledger row, one receipt |

**This is the milestone the brief named: from production data, money at Stripe
and money in Steward now agree** for that charge — Stripe charge → gift → ledger
→ donor total → subscription link → tax receipt → email, every link confirmed.
The portal/cross-org figures read as live SUMs over the gift rows, so they move
with the recorded gift by construction.

`/health.reconciliation` now reads `unrecordedCharges: 0` **correctly** (the gift
exists, so the charge is matched) — where before recovery it read 0 while the
charge was genuinely unrecorded (the blindness question, answered by
`accountsErrored` once `4802bba` deploys).

**Still outstanding (Jonathan):** the **fresh** live charge
(`BLOCKED-build62-verify.md`) — a brand-new subscription proving the ordering fix
under real concurrent delivery. The recovered $1 proves the recording chain end
to end; the fresh charge proves the race is closed. No second subscription is in
the roster yet, so that leg is pending.

---

## POST-SHIP OBSERVATION — the guard reported "clean" for a charge I know is unrecorded

With BUILD-62 live, `/health.reconciliation` ran in prod
(`checkedAt 2026-08-17T20:04:59Z`) and reported `unrecordedCharges: 0` — but the
drill's $1 charge is still unrecorded (Jonathan hasn't recovered it yet), so it
should have been flagged. I could not reproduce the guard's `charges.list` from
this environment: the Stripe CLI's **restricted** `rk_live` key returns
`account_invalid` ("does not have access to account … Application access may have
been revoked") for `charges.list`/`payment_intents.retrieve` on the connected
account — though the SAME key can read that account's *events* and
*subscriptions*. So a restricted key can be scoped such that it reads some
resources on a connected account but not charges.

That is exactly the silent-failure shape this build exists to kill: the guard
`continue`d past a read failure and the account contributed 0, so `/health` read
all-clear while the guard was **blind**. **Fixed:** `reconcileStripeVsGifts` now
counts `accountsChecked` / `accountsErrored`; a read failure is logged as "guard
BLIND for this account" + Sentry, and `/health.reconciliation.accountsErrored`
surfaces it. **`unrecordedCharges: 0` is only trustworthy when `accountsErrored:
0`.** Pinned by `reconciliation` Scenario 7 (a 403 on an account → counted
errored, surfaced on /health, not silently clean).

**Action / open question for Jonathan:** once `fbe40ba`+ is live, read
`/health.reconciliation` — if `accountsErrored > 0`, the prod donation key is a
restricted key without connected-account **charge** read, and the guard is blind
in production (it must be given a key that can read charges on connected accounts,
or the restricted key's scope widened). If `accountsErrored: 0` with
`accountsChecked > 0` and still `unrecordedCharges: 0`, then either CREO's
connected account isn't `acct_…4aV` in the `orgs` row the guard scans, or a gift
already exists for that charge — worth a direct look. The prod donation key
CREATES charges on connected accounts (donations require it), so it most likely
CAN read them and `accountsErrored` will be 0 — but the guard now tells the truth
either way instead of guessing.

## §worry

- **The reconciliation guard is still the only backstop, and it is detection, not
  prevention.** Fix C makes the refund-race *visible*; it doesn't stop it, and
  there is still no one-click reconcile-and-record. The guard runs every 20 min
  and pages via `/health` — a donor charged-and-dropped is visible within the
  hour, not the instant. That is the honest ceiling until a backfill action
  exists.
- **`charge.dispute.*`←gift is the same shape as the refund race and is not
  specifically caught.** A dispute that raced ahead of its gift would leave an
  un-flagged gift. Disputes lag charges by days, so it's very low-likelihood, but
  the reconciliation guard could be extended to reconcile disputes the way Fix C
  reconciles refunds. Deferred.
- **The manifest check depends on the LIVE endpoint being listable.** It reads
  `stripe.webhookEndpoints.list` with the platform key; a restricted key that
  can't read webhook endpoints would leave `missingCount` null (unchecked) rather
  than wrong — but "unchecked" must not be read as "clean". `/health` reports
  `checked:false` in that case; watch for it.
- **Cross-worker concurrency is now handled with DB-level compare-and-swap and
  `ON CONFLICT`, not app-level checks** — the right primitives — but this codebase
  runs a single Railway instance today. The fixes are correct for the multi-worker
  future the brief asked about; they are not currently load-bearing against real
  multi-worker delivery because there is one worker. If Steward scales to multiple
  instances, this whole family should be re-drilled under genuine parallel
  delivery, not just `Promise.all` against one process.
