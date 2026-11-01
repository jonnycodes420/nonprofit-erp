## 4 · Stripe dashboard — three events and one replay

1. **Add `payment_method.automatically_updated`** to the live donation endpoint
   `we_1Tslmv7rAzrXok5S7b0EmR6f` (Developers → Webhooks → that endpoint → add
   event). Steward has handled it since the card-recovery work; Stripe has never
   sent it, so Card Account Updater recoveries are silently not happening.
   PARITY-4: "Cards updated automatically" on Recurring and the timeline line
   both come from this event, so they stay at 0 on prod until it is added.
1b. **Add `checkout.session.expired`** to the same endpoint (PARITY-4). A
   Checkout that closes unpaid marks the "Started but didn't finish" row. Rows
   from the three-step form's email step appear without it; the session's own
   expiry does not.
2. **Add `charge.dispute.updated`** to the same endpoint — a dispute moving to
   `under_review` currently never reaches us.
3. **Add `invoice.payment_succeeded`** to the billing endpoint — the handler that
   marks an org active and clears grace on a successful renewal.
4. **Resend the drill's original `payment_intent.succeeded`** (Events, on the
   CREO connected account → the $1 subscription charge → Resend). The
   subscription row exists now, so the fixed handler records the gift. No
   re-charge; idempotent on the PI id.
