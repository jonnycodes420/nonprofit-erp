## 0-GIVE-2 · THREE THINGS ONLY YOU CAN DO (2026-10-02)

**1. Turn the payment methods on in Stripe.** The donation form no longer pins
Checkout to cards, so a donor is offered whatever each connected account accepts.
That is the ACCOUNT's setting, not Steward's: in the Stripe dashboard, Settings →
Payment methods, switch on Link, US bank account (ACH) and, if you want it,
PayPal. Until an org does that, its donors still see cards only and Settings →
Giving Pages says so honestly. Nothing is broken either way.

**2. A Stripe test connected account for the demo.** Settings → Giving Pages
reads the connected account's capabilities to show which methods will appear.
Harborlight is not connected, so that card reads "Connect Stripe to see which
payment methods your donors will be offered." To demonstrate the wallets list on
the demo, point `org_b72demo.stripe_account_id` at a real Stripe TEST connected
account and set `stripe_connected = true`. I did not invent one: a fabricated
`acct_…` makes the capability read fail, and a screen that says "Apple Pay: on"
for an account that cannot take it is the one thing this card exists to prevent.

**3. A matching-gift lookup partner, if you want one.** `shared/employerMatch.js`
has the adapter shape, behind `MATCHING_LOOKUP_ENABLED` with no provider
registered and no vendor named anywhere in the code or on the site. Signing one
is a contract. What ships today needs nothing: each org types the two or three
large employers it already knows match, with the company's own form link, and
those appear on the page a donor lands on after giving.
