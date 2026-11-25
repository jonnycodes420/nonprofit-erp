# ORDER-1 · The order she reads, signs and puts a card on file in one link (25 Nov 2026)

Jonathan approved the mockup on 24 Nov and chose to build the signature into Steward's own close link
instead of paying for an e-sign vendor. ONBOARD-4 had changed Terms §4 to say the price and setup fee
are "in the quote or order you sign"; the close link took a card, but there was no order to sign.

- **Where it lives.** The order rides ONBOARD-1's start link (the close link for an org that exists),
  not a third path: `start_links` gains `order_number` (SW-YYYY-NNNN), `order_json` (what Jonathan typed),
  `order_version`, `deal_id`. A link without an order still shows ONBOARD-1's page. SALES-3's quote is
  untouched.
- **One snapshot.** `server/onboard/order.js` builds every line and figure the page shows from
  `shared/numbers/orderFigures.js`; the page, the signature, the PDF, the email and Checkout read it.
  The stale check hashes what is shown (the date, not the instant), so an order edited after she
  opened it, or a 30-day order left open past midnight, reloads with "This order was updated on …".
- **The record.** `order_signatures` (append-only by trigger) keeps the snapshot, its SHA-256, the Terms
  version (`shared/terms.json`, which the Terms page now reads: ONBOARD-4 changed §4 and left the old
  date), name, title, email, time, IP and browser. ONBOARD-1's `start_signatures` row is written too, so
  Settings → Billing and the paper gate read it unchanged. The PDF is drawn from the stored snapshot.
- **Money.** Checkout holds `trial_end` at the first charge she signed for; the typed price is an inline
  price on the band's own product, per month or per year; the setup fee is an invoice item tied to the
  subscription after the card goes in (SALES-3's rule), once, even on a redelivered event.
- **The deal.** Found from the org's linked sales organization; moves to Signed, then Card on file
  (added after Verbal yes the first time a pipeline needs them, by the signer's system actor).
- **Mail.** Two kinds, both billing mail (`mailPolicy.js`): the signed copy to the signer, and "Review and
  sign your order" only when Jonathan presses Send. An unknown kind is donor mail by rule, which is why the
  first local run sent nothing.
- **Existing customers.** `GET /admin/orders/unsigned` (the "Orders to sign" card) lists orgs on a paid plan
  or that came through a close link with no signed order. A paying org signs with no Checkout and no
  second subscription; its Stripe billing is left as it is.
