# BLOCKED — the LIVE-key recurring drill (Jonathan, ~10 minutes)

The standing rule stays in force: **no real nonprofit gets approved until this
runs.** BUILD-57 §2a drilled the full lifecycle against real Stripe **test
mode** (see `docs/build57/stripe-drill/DIFFERENCES.md` — 7 real-Stripe bugs
found and fixed there). Two things still require the live key and a real
card, and only you can run them.

## Before you start (2 min, dashboard only)
1. Stripe dashboard → Developers → Webhooks → the prod Connect endpoint
   (points at nonprofit-erp-production.up.railway.app/stripe/webhook).
   **Note its API version.** If it is 2025-03 or newer, the payloads use the
   NEW shapes (no `invoice.subscription`, no `pi.invoice`) — BUILD-57's
   normalizers handle both, but knowing which shape prod receives tells us
   which code path is live.
2. Same endpoint: confirm these events are subscribed (BUILD-45-era list):
   `checkout.session.completed`, `payment_intent.succeeded`,
   `invoice.payment_failed`, `invoice.payment_succeeded`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.refunded`.

## The drill (8 min, your own card, ~$5 total, refunded at the end)
Use a portal-enabled org you control (org_creo works; its gifts are demo
fiction anyway) — its connected Stripe account must be charges-enabled.

1. **Create:** open the org's Give page → monthly gift, $5, pick a FUND
   designation → pay with your real card.
   *Check (1 min later):* Fundraising → Recurring Giving shows the
   subscription Active, designated to that fund, next charge ~1 month out;
   the donor profile shows a $5 gift; Finance ledger shows the stamp routed
   to the fund.
2. **Increase:** on the roster row → Actions → Propose a change → amount $7.
   Open the email (it goes to the donor email you used) → confirm.
   *Check:* roster shows $7; Stripe dashboard shows the subscription at $7
   under a product named "… recurring gift".
3. **Pause, then resume:** roster Actions. *Check:* Stripe dashboard shows
   pause_collection set, then cleared; you got both donor emails.
4. **Cancel:** roster Actions → Cancel. *Check:* Stripe shows
   cancel-at-period-end; you got the donor email.
5. **Refund:** Stripe dashboard → Payments → refund the $5 (and the $7 if a
   second charge slipped in). *Check:* the gift disappears from the donor
   profile and the ledger row is gone (full-refund reversal).

## What a pass means
The seven test-mode fixes hold on the live key + live webhook endpoint, and
the recovery/notification chain a pilot org depends on is real. If step 1's
gift does NOT appear within ~2 minutes, the webhook endpoint's event list or
API version is the first suspect — capture the event id from the Stripe
dashboard and we can replay it.

Card-failure recovery can't be drilled on a live card (no way to make a real
card fail on purpose) — that path is covered by the test-mode drill's real
failing-card run and stays test-mode-only by design.
