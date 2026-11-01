## 1b · GTM-1a — SEVEN STRIPE PRICES, AND NOTHING SELLS WITHOUT THEM

The public pricing page and `/signup` are live, and **every band refuses to take
a card until its Stripe price exists.** The refusal is clean and says so
("That plan is not available to buy online yet"), and the server logs which
variable is missing — but a visitor cannot buy anything until these are set on
**Railway → nonprofit-erp → Variables**:

| Variable | Stripe price to create | Amount |
|---|---|---|
| `STRIPE_PRICE_T1000_MONTHLY` | recurring monthly | $199 |
| `STRIPE_PRICE_T1000_YEARLY` | recurring yearly | $1,990 |
| `STRIPE_PRICE_T5000_MONTHLY` | recurring monthly | $299 |
| `STRIPE_PRICE_T5000_YEARLY` | recurring yearly | $2,990 |
| `STRIPE_PRICE_T10000_MONTHLY` | recurring monthly | $499 |
| `STRIPE_PRICE_T10000_YEARLY` | recurring yearly | $4,990 |
| `STRIPE_PRICE_INTERNAL_TEST` | recurring monthly | **$1** |

All in **USD**, `interval_count: 1`. The amount and the cadence are CHECKED
against Stripe before any link is minted or any card is taken, so a price at
the wrong amount refuses rather than quoting one number and charging another —
that is the trap production was already in once (BUILD-90). `/admin/close-links`
shows every band as configured / ready with the amount Stripe actually holds.

`STRIPE_PRICE_CORE` / `_TEAM` / `_FOUNDING` are **untouched** and stay set: real
orgs are on those prices.

**The founding coupon** `Gv9E1KkK` (code `STEWARD50`, $50 off) already exists and
is recorded in `pricing.js`. GTM-1b 4 applies it on any tier.

**The $1 live test is yours, and it is the honest half.** Super-admin console →
**Organizations** → the `$1 test` button on an org's row. It moves that org's
LIVE Stripe subscription onto the $1 price and confirms first. Use it on an org
you own, let one real invoice land, read it, then move them back with `Plan`.
Nothing but a real charge proves the path.
