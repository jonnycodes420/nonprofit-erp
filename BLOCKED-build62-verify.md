# BLOCKED — prove the BUILD-62 fix with a SECOND live charge (Jonathan, ~10 min)

The fix is deployed and the first dropped $1 is recovered (see
`audit/BUILD-62-FINDINGS.md`). But the *only* proof that counts for a
webhook-ordering race is a **fresh live charge on live keys** — a brand-new
subscription where Stripe emits `payment_intent.succeeded` ~2s before
`checkout.session.completed` and delivers them concurrently to the real
endpoint. I can't run this autonomously: it needs a real card on the public
Checkout page. You can, in about ten minutes.

Recovering the first $1 (which I did, by re-delivering its original
`payment_intent.succeeded` event) proves the *recording chain* — but that event
was re-delivered **after** the subscription row already existed, so it does not
exercise the race. This drill does.

## Before you start (30 seconds)
Confirm the fix is live: `curl -s https://nonprofit-erp-production.up.railway.app/health`
→ `buildSha` should match the BUILD-62 commit, and the response now carries a
`reconciliation` block. If `buildSha` is old, the deploy hasn't landed yet — wait.

## The drill (8 min · your own card · $1 · refund at the end)
Use a portal-enabled org you control — **org_creo** works (its gifts are demo
fiction, and its connected account `the CREO connected account` is charges-enabled).

1. **Create a NEW subscription.** Open the org's Give page
   (`https://www.stewardapp.dev/give/creo-arts-creo`), choose **monthly**, amount
   **$1**, and — importantly — **pick a FUND designation** this time (so we also
   confirm the fund carries; the first drill left it blank). Pay with your real
   card. Use a DIFFERENT email than the first drill's `the demo donor's address (Jonathan's own inbox)` if you
   want a clean new donor (e.g. a fresh `+b62live` alias of your own address), or the same to add
   a second sub to the existing donor.

2. **Wait ~2 minutes**, then check — this is the whole point, and every one of
   these must be TRUE where before they were silently false:
   - **The gift row exists.** Fundraising → Recurring Giving: the new
     subscription shows **Active** with **total given $1** / **1 linked gift**
     (not $0 / 0 — the old bug). The donor's profile shows a **$1 gift dated
     today**.
   - **The ledger stamp is right and the fund carried.** Finance → Transactions:
     one **Online · Stripe** row for $1, routed to the fund you picked.
   - **The org portal total moved.** The donor portal / cross-org dashboard
     lifetime and this-year figures each went up by $1.
   - **The tax receipt appears.** Donor profile → Gifts & Pledges → the new gift
     has a **Receipt ✓ #…**.
   - **The receipt email arrived.** Check the inbox for the address you used — a
     Steward receipt for $1 from CREO Arts.

3. **Refund** the $1 in the Stripe dashboard (Payments → refund). Check the gift
   disappears from the donor profile and the ledger row is gone (full-refund
   reversal). NB: `charge.refunded` is **not currently subscribed** on the live
   endpoint (see the FINDINGS §worry), so the refund may NOT auto-reverse in
   Steward yet — if it doesn't, that confirms the endpoint-event gap, and the
   reconciliation guard will flag the now-orphaned gift within ~20 min. Add
   `charge.refunded` (and `charge.dispute.*`) to endpoint
   `the live Connect webhook endpoint` in the Stripe dashboard when convenient.

## What a pass means
A brand-new live subscription recorded its first charge end-to-end — gift,
ledger, fund designation, portal totals, tax receipt, and inbox — under the real
concurrent webhook delivery that dropped it before. That is the fix proven the
only way that counts: the numbers on the page changing.

If the gift does NOT appear within ~2 minutes: capture the subscription id and
the connected-account event ids from the Stripe dashboard (Developers → Events,
on the connected account), and check `POST /admin/reconcile/run` (super-admin) —
it will report the charge as unrecorded with its id/account/amount/age.
