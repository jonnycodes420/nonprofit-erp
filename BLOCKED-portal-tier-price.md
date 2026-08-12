# BLOCKED — Portal-tier pricing (founder decision, with the cost floor)

BUILD-46 §3.1 ships the Portal tier (plan `portal`): white-label donor portal +
donor-dashboard listing + gift recording + receipts + impact updates. NOT the
CRM (server-enforced: moves/portfolios/reports-beyond-giving-summary/comms/
workflows are 403 `portal_tier`). Free-or-cheap is yours to price; the floor:

## Cost floor per portal org (monthly, rough)
- **Stripe fees: $0 to Steward** — gifts settle in the org's own Stripe
  account (Standard Connect); processing fees are theirs. Steward carries no
  payment cost and takes no cut (the 0%-platform-fee promise holds).
- **Infrastructure: near-zero marginal.** Shared Railway/Supabase/Vercel; a
  portal org is a few MB of rows + portal traffic. Real infra cost appears
  only at thousands of orgs (DB size, email volume).
- **Email (Resend):** magic links + receipts + confirmations. At ~200
  donors/org active monthly ≈ low hundreds of emails/org — Resend's paid tiers
  price per 1k; budget ~$0.10–0.50/org/month at scale.
- **Support load is the REAL cost:** EIN review (~5 min/org one-time, yours),
  donor sign-in support, an org admin asking questions. Even 15 min/org/month
  at any reasonable rate dominates infra.
- **Trust budget:** every listed org carries reputational risk to the network;
  the review gate is the control, but a paid tier (even $19/mo) is itself a
  spam filter.

## Options to price against
- Free (growth play; the gate + EIN + Stripe KYC as the abuse filter).
- $19–29/mo (self-serve; filters abuse; covers support).
- Free portal + paid listing (portal free, dashboard listing $X) — awkward to
  explain; not recommended.

Upgrade path is already clean: same org record, flip `plan` core/team, data
in place. Checkout wiring for a paid Portal tier would reuse
`create-billing-products.js` + a `STRIPE_PRICE_PORTAL` env (≈half a day).
