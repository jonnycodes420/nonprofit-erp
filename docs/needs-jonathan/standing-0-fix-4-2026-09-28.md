## 0 · FIX-4 (2026-09-28) — the $1 test, end to end

Nothing here blocks a deploy. Two of them are yours because only you can press
them.

**a. How to run the $1 test, exactly.** It moves a LIVE subscription, so it
only appears where there is one to move.

1. Sign in to `stewardapp.dev` as the super admin and open the admin console.
2. Find the org in the Organizations table. The **$1 test** button sits in its
   Actions column. If you do not see it, that org has no Stripe subscription on
   file (or it is the Harborlight demo, which never gets one). Press **Find
   subscription** instead: it reads the subscription back from Stripe and saves
   it, creating nothing and charging nothing. The $1 test then appears.
3. Press **$1 test**. Confirm the dialog, which names the org and says plainly
   that this changes their live subscription and their next invoice will be $1.
4. Steward checks in Stripe that `STRIPE_PRICE_INTERNAL_TEST` really is a
   recurring $1 USD price before it moves anybody, then swaps the subscription
   item onto it with no proration, and sets the org's plan to `internal_test`.
5. Watch the charge land in the Stripe dashboard at the end of the trial, or
   end the trial early in Stripe to see it now.
6. Move them back with the **Plan** button beside it, or by changing the plan
   in Stripe's own portal.

Any refusal now reads as a sentence rather than a code. The three you might
see: the price variable is not set, the price it points at is not a recurring
$1 USD price, or Stripe has no live subscription for that org.

**b. One thing worth a look while you are in Stripe.** The health check that
reports "handled event types not subscribed on the live endpoint" diffs the
**/billing/webhook** endpoint using the DONATION Stripe client. The two clients
are deliberately separate accounts. If the billing endpoint lives on the
platform billing account, that guard has been reporting it as missing all
along, and a genuinely unsubscribed `checkout.session.completed` there would
look identical. Worth confirming by eye in the Stripe dashboard that
`checkout.session.completed` is subscribed on the **billing** webhook endpoint.
Not fixed in FIX-4: it is a monitoring bug, not a signup bug, and it needs a
decision about which account owns which endpoint.
