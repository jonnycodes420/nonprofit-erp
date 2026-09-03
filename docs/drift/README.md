# BUILD-76 — drift, proven

## The live-Stripe drill (Part 3.2 — no mocks)

`scripts/build76-drift-drill.js` (SELF_REFUSING: loopback only) drives drift
against REAL Stripe test mode with live signed webhooks. Rig:

```bash
# 1. real webhooks into a scratch server
stripe listen --forward-connect-to 127.0.0.1:5621/stripe/webhook
# 2. boot the drill server with the printed whsec + the CLI's sk_test key
DATABASE_URL=postgres://steward@localhost:5544/steward_loadtest DB_SSL=disable \
JWT_SECRET=local-test-secret PORT=5621 TEST_MODE=1 SESSION_CACHE_TTL_MS=0 \
RESEND_API_KEY=re_dummy_local RESEND_BASE_URL=http://localhost:5602 \
STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_<printed> \
DISABLE_BACKGROUND_TICKS=1 node server.js
# 3. run it (Playwright completes the real Checkout)
STRIPE_SECRET_KEY=sk_test_… PLAYWRIGHT_DIR=$HOME/steward-qa node scripts/build76-drift-drill.js
```

Latest run: `stripe-drill-2026-09-03.log` — **21/21**. What it proves, live:
a drifting donor's real charge clears the list + badge and drops the headline
by exactly their value at risk; the FIRST charge of a brand-new subscription
(real Checkout, the case that once dropped in production) lands as sub row +
gift; a failed first recurring charge lives in the failed-payment path and
the donor is EXCLUDED from drift; a real refund puts the drift flag straight
back (computed on read — no stale state is possible).

Gotchas the drill re-learned: stripe-node retrieve() needs the 3-arg
stripeAccount form (BUILD-57 finding), and a REUSED test connected account
must be released from earlier drill orgs or event.account resolves every
webhook into the first run's org.

## The deterministic battery (Part 3.1/3.3/3.4)

`tests/drift.test.js` (72, in run-all) — the brief's fixture table by name
through the real import path, exclusion family, one-computation proofs,
manual entry, mock-signed webhook + refund, the logging loop, the cap.

## The walk (Part 3.5)

Screenshots in this directory (`walk-*.png`), 1440 + 390, taken after 8pm
in the walked org's own timezone. Notes in WALK.md.
