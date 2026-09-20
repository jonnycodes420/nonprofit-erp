# BLOCKED-build90 — the three things this build cannot do for itself

Written 20 September 2026, at the end of BUILD-90 (the close link and the
billing date).

Everything on Steward's side of the wire is built, tested and green. What is
left is money that only Jonathan can create, and one real run through it.

---

## 1. THE THREE LIVE-MODE STRIPE PRICES — Jonathan's, by the standing rule

**Anything that spends or charges money is his to create**, so the code reads
ids from the environment and refuses to mint a Checkout session without one.
That refusal is deliberate: a close link that cannot charge is better than one
that quietly charges the wrong amount.

The amounts changed in this build. They are Founding **$199**, Core **$249**,
Team **$499** — the prices the invitation page and the founding-partner terms
have quoted since August, which the pricing page and the billing tables had
never been moved to.

```bash
# TEST first, always. Idempotent — a re-run reuses an existing product/price.
STRIPE_BILLING_SECRET_KEY=sk_test_… node scripts/create-billing-products.js

# Then, only after the test-mode flow is green:
STRIPE_BILLING_SECRET_KEY=sk_live_… node scripts/create-billing-products.js --live
```

It prints the three `STRIPE_PRICE_*` lines. Paste them into Railway.

**A note on the old prices, and the trap they set.** The script previously
created Core at $149, Team at $299 and a founding coupon of 34% off. Those
Stripe objects still exist and are untouched — nothing here deletes or edits a
price, because a price with a subscription on it must not move. No org is on
one. The founding coupon's id now carries its percentage
(`steward_founding_20off`), so changing the discount cannot silently reuse the
previous coupon.

**The trap: production already has all three `STRIPE_PRICE_*` set, in live
mode, at the RETIRED amounts.** The prod smoke after this build's deploy
showed `/health` reporting `billing.ok: true` — every id resolves. So
"configured" was true and the amounts were wrong, and a close link would have
shown the executive director "$249" on the Checkout page while Stripe charged
$149. That is exactly the contradiction between the contract and the product
this build exists to remove, so **the amount is now verified against Stripe
before a link is minted**: a mismatch refuses with `plan_price_mismatch` and
names both numbers. `GET /admin/close-links` reports `ready` per plan — the
amount Stripe actually holds against the amount the page would quote — rather
than the false comfort of `configured`.

**`closeLink.js`'s `CLOSE_PLANS` is the source of truth for the amounts.** If a
price changes, change it there; `tests/one-date.test.js` fails until the
provisioning script, the MRR table and the pricing page agree with it.

---

## 2. RAILWAY ENVIRONMENT

| Variable | Value | Why |
|---|---|---|
| `STRIPE_PRICE_FOUNDING` | the live $199 price id | a close link on Founding refuses without it |
| `STRIPE_PRICE_CORE` | the live $249 price id | ditto, Core |
| `STRIPE_PRICE_TEAM` | the live $499 price id | ditto, Team |
| `FOUNDER_EMAIL` | `jonathan@stewardapp.dev` | the From on the welcome email and the seven-day reminder. **Must be a verified Resend sender.** Unset falls back to `noreply@`, which is the wrong voice for both |

`GET /admin/billing-diagnostic` already reports whether the key and the price
ids are in the same Stripe mode. `GET /admin/close-links` now reports, per
plan, whether a price is configured at all.

**Do NOT set `STRIPE_BILLING_API_BASE` in production.** It is a local-test seam
(the twin of `STRIPE_API_BASE`) that points the billing client at a mock.

---

## 3. ONE REAL CLOSE LINK, ON PROD, WITH HIS OWN CARD

The battery drives the whole path against a local Stripe mock — the route, the
session parameters actually sent, the signed webhook, the provisioning, the
welcome email, the reminder and both kinds of cancel. What it cannot do is
prove Stripe's own behaviour in test or live mode, so:

1. `POST /admin/close-links` with a throwaway org name and an email he controls.
2. Walk the Checkout page. **Read the sentence above the button** — it should
   name the date thirty days out and say "cancel any time before then and you
   pay nothing."
3. Complete it with his own card.
4. Confirm in Stripe: subscription **trialing**, trial end thirty days out,
   **no charge, no invoice**.
5. Confirm the welcome email arrived and its set-password link works.
6. Cancel — from Settings → Billing, or the link in the email. Confirm the
   subscription is gone and no charge was ever made.
7. Delete the throwaway org.

---

## 4. WHAT THIS BUILD DELIBERATELY DID NOT DO

- **No Stripe price or product was created, edited or deleted.** Every money
  object stays Jonathan's.
- **No existing org's `trial_ends_at` was migrated.** The free-through-2026
  rule is deleted from the code, and `scripts/extend-trials-free-through-2026.js`
  is deleted with it, but no UPDATE was run against any database. **No customer
  has signed**, so there is nothing to grandfather and nothing to shorten. If a
  throwaway org on the old rule ever needs correcting, correct it by hand and
  in the open.
- **`POST /admin/orgs/:id/extend-trial` still exists** (super-admin). "Nothing
  moves the trial end" is a promise about what the PRODUCT does to a customer —
  imports, re-imports, rescheduled meetings. It is not a claim that Jonathan
  cannot make somebody an exception on purpose, with his own hands, on a route
  only he can reach.
- **The legacy `POST /auth/register-org` and `POST /auth/register` are still
  mounted.** Neither is reachable from the UI (/signup redirects to the
  invitation request). They were brought onto the same thirty-day rule rather
  than removed, because removing a mounted route is a separate decision with
  its own blast radius.
- **THE FIRST PRODUCTION TICK IS SILENT, BY CONSTRUCTION.** The seven-day
  reminder runs every six hours from boot, so it is worth knowing exactly who
  it can reach on the first deploy. It requires all four of: status
  `trialing`, a plan with a price (`founding`/`core`/`team`), a trial end
  inside the next seven days, **and a real Stripe subscription id**. The last
  condition is there on its own merits — an email naming an amount, a date and
  a card's last four must never reach an org that has none of those — and it
  also means a manually-granted plan, a demo org, or a legacy trial that never
  went through Checkout is never warned about a charge that is not coming.
  Every org created before this build carries the retired free-through trial
  end of 2026-12-31, which is more than seven days out, so nothing fires on
  deploy either way.
- **A contact email that already has an account is refused when the link is
  minted.** If it somehow collides at completion time — the account was created
  in between — nothing is provisioned, the link stays open, and the server logs
  CRITICAL plus a Sentry message. A half-made organisation, or a user moved
  between organisations, would both be worse than a loud stop.
