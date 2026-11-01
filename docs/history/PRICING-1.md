## PRICING-1 · Record-banded pricing and setup fees (2026-10-21)

Jonathan, 21 Oct: one plan, priced by records (people with at least one gift), four bands with a
one-time setup fee, every number in `pricing.json`. The server serves the file at /public/pricing so
signup, Billing and the plan picker change without a client build. A band moves only with the
owner's yes, after two months running over and thirty days' notice; custom prices never move.
The trap: the setup fee makes Stripe's first invoice non-zero, and the webhook read any paid
`subscription_create` invoice as the first monthly charge, ending a new org's thirty days at
signing (planted, red, fixed). The admin MRR also read the first priced line, which can be the
one-time fee. The live prices are Jonathan's to create (`scripts/stripe-live-prices.js --live`).
Seed unchanged.
