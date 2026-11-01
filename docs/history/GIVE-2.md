## GIVE-2 · donation forms that raise more (2026-10-02)

- **The form stopped pinning Checkout to cards.** `payment_method_types: ["card"]`
  was one line in `donateHandler` and it is why a donor on an iPhone had to type
  sixteen digits. Omitting it turns on Stripe's dynamic payment methods, so the
  CONNECTED ACCOUNT decides: Apple Pay, Google Pay, Link, US bank account and
  PayPal where the org has them on, and nothing it cannot take. That guarantee is
  by construction, not by a capability check of ours — a list Steward computed
  could be stale the moment a capability changed.
- **Venmo is not on offer and the settings card says why.** Steward takes
  payments on the org's own Stripe account, Stripe does not offer Venmo, and the
  PayPal connection reads a statement rather than taking a payment. Saying so
  beats a row that never lights up.
- **The processing rate became the org's** (`shared/processingRates.js`). It had
  been Stripe's published card rate hard-coded in `routes/give.js` and
  hand-copied into `Donate.jsx` and `EmbeddedForm.jsx` — three copies of one
  number, wrong in the expensive direction for an org on Stripe's nonprofit rate
  (2.2%) and for every bank transfer (0.8% capped at $5). A NULL column still
  answers with the published default, so nobody's arithmetic moved by a cent
  until they typed a number.
- **Four figures on an online gift, footing to the cent** (`shared/giftFooting.js`):
  gross, covered, fee, net. The FEE is read off the charge's own balance
  transaction rather than computed from a rate — the configured rate is what the
  form asked for, the balance transaction is what happened, and it is the number
  that reconciles against a payout. `processor_fee_amount` has defaulted to 0
  since BUILD-89S, so `processor_fee_source` is what tells "nothing was taken"
  from "nobody has told us yet".
- **And the method came off the charge too.** `paymentMethod: "Card"` was
  hard-coded in the webhook, so every bank transfer was recorded as a card gift
  in the column the deposit sheet and every method breakdown read.
- **Smart amounts** (`shared/smartAmounts.js`): a returning donor on their own
  personal link sees amounts starting from their own last gift, unrounded;
  everybody else sees amounts drawn from the org's own gifts through that form.
  From the org's own data and nothing else — no wealth, no capacity, nothing
  bought from anybody. Off by default, because a fundraiser who typed four
  numbers is not overruled by a median, and silent below eight gifts, because
  that is not a distribution.
- **Express giving**: "remember me" saves the method on the org's own Stripe
  customer, and an email sign-in link gives again in one tap. Steward holds two
  Stripe ids and four digits; no card number, no expiry, no CVC, at any point.
  The link lives in `portal_magic_links` with a `purpose`, which is load-bearing
  and filtered in SQL at both ends: an express link may not open the portal and a
  portal link may not charge a card. It is consumed by a POST, because a GET
  never changes state.
- **Failed-card recovery, shown.** The engine has run since BUILD-63 and the only
  thing it showed for its work was a percentage. Three figures for the year, each
  opening its rows; the money figure's rows are gifts, so it foots against
  Reports rather than standing beside it.
- **Matching gifts** stayed honest: the adapter shape exists behind
  `MATCHING_LOOKUP_ENABLED` with no provider registered and no vendor named, and
  what ships is each org's own typed list of employers with the company's own
  form link, shown on the page a donor lands on after giving.
- **The three defects the browser walk caught**, none of which a suite would
  have: `withSmartAmounts` was wired into `/forms/:id/public` and NOT into the
  giving-page payload the public page actually reads, so the ladder was still
  Steward's guess; `FRIENDLY_CENTS` skipped $2,000 and $3,000, so a donor whose
  largest gift was $2,000 was asked for $5,000; and `expressDonorByEmail` selected
  a `first_name` column that `donors` does not have, which 500'd the whole
  one-tap open. A fourth, in the seed: the recovered subscription's gifts already
  carried their subscription id, so an `IS NULL` guard matched nothing and the
  panel showed a recovery with no gifts behind its money figure.
- **The one test**, `tests/give2-fee-footing.test.js`: the four figures foot for a
  card gift and an ACH gift, the gross-up follows the org's rate, an unreadable
  fee is not a fee of zero, and the panel's dollars equal the sum of the rows it
  opens. Three defects were planted (the hard-coded rate, no fee read, the
  hard-coded method) and each went red before the green was trusted.
