## 0-NEW · THE DEMO ORG HAS NO CONNECTED STRIPE ACCOUNT (2026-09-28, EVENTS-2)

EVENTS-2 lets the public event page take a card, and the whole path is proven
by `tests/events2-checkout.test.js` against a Stripe mock. On Harborlight the
page still shows the old "we will be in touch about paying" flow, because
`orgs.stripe_connected` is false for `org_b72demo` and a page that offers to
take a card with nowhere to send it is worse than one that does not.

To walk a live test-mode purchase on the demo you would connect a Stripe
**test-mode** Express account to Harborlight through the normal Connect
onboarding in Settings. That is your Stripe login and your decision, and
nothing else waits on it: every other org that is connected gets paid tickets
the moment this deploys.
