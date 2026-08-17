# BLOCKED-build63 — the human/dashboard actions BUILD-63 surfaced

Nothing here is undecidable in the "I don't know what to do" sense — each item
has a clear action; they're blocked only because they need a card, a Stripe
dashboard, or a prod credential I don't have. Consolidated so you can clear them
in one pass. Full context: `audit/BUILD-63-FINDINGS.md`, `audit/BUILD-62-FINDINGS.md`.

## 1. The second live charge — prove the race fix (10 min, your card)
`BLOCKED-build62-verify.md`. A fresh live subscription on org_creo proves the
BUILD-62 ordering fix under real concurrent delivery. Then verify from data
(BUILD-63 Part 5): one sub row + one gift per subscription, amount/fund/ledger
correct, portal + cross-org + receipts moved, `/health.reconciliation` zero
divergence, recovered $1 + fresh charge both present and neither duplicated.

## 2. Recover the first dropped $1 (2 min, Stripe dashboard)
Re-deliver the drill's original `payment_intent.succeeded` to the donation
endpoint (Stripe → Developers → Events, on the CREO connected account → the $1
subscription charge's PI event → "Resend"). The subscription row now exists, so
the (now-fixed) handler records the gift — no re-charge. Steward has NO built-in
backfill; re-delivery is the reconcile-from-Stripe path (idempotent on the PI id).

## 3. Fix the live endpoint's subscribed events (5 min, Stripe dashboard)
From the read-only `scripts/check-webhook-subscriptions.js --i-know-this-is-prod`
diff (also in FINDINGS):
- **Donation endpoint (`/stripe/webhook`): ADD `charge.dispute.updated`** — the
  dispute handler processes it but it isn't subscribed (a dispute moving to
  under_review won't reach us). Optional: remove `charge.dispute.funds_withdrawn`
  / `charge.dispute.funds_reinstated` (subscribed, no handler — harmless noise).
- **Billing endpoint (`/billing/webhook`): ADD `invoice.payment_succeeded`** —
  the billing handler marks the org active + clears grace on a successful
  renewal, but the event isn't subscribed. Optional: remove
  `customer.subscription.created` (subscribed, no handler).
`/health.webhookSubscriptions.missingCount` reads 2 until these are added.

## 4. Confirm the reconciliation guard can SEE production (1 min, curl)
After `4802bba`+ is live, `curl …/health` and read `reconciliation`:
- `accountsErrored: 0` with `accountsChecked > 0` → the guard read every
  connected account; a `unrecordedCharges` value is trustworthy.
- `accountsErrored > 0` → the prod donation `STRIPE_SECRET_KEY` is a restricted
  key without connected-account **charge** read. Give the guard a key that can
  read charges on connected accounts (or widen the restricted key's scope) — the
  guard is otherwise blind and `unrecordedCharges:0` is not a clean bill.
  (The donation key CREATES charges on connected accounts, so it most likely can
  read them; this just confirms it.)

## 5. Remove the demo placeholder art in prod (2 min, one command) — BUILD-62 Part 5
`scripts/fix-build54-demo-photos.js` against prod (+ the seed re-run) replaces
the seeded placeholder-SVG "photos" (the "Harbor blue circle+square") with real
committed photos. This was classifier-blocked in BUILD-54 and never applied to
prod. The render side already degrades a photoless impact card to the org
monogram band.

## 6. Wire the two new /health counters into UptimeRobot (5 min, your account)
Alongside the existing `themeAssets.dbFallbackRows` keyword watch, add keyword
alerts on `reconciliation.unrecordedCharges` (and `reconciliation.accountsErrored`)
and `webhookSubscriptions.missingCount` being non-zero, so a charged-and-dropped
donor, a blind guard, or a handler-with-no-subscription pages within the hour.
