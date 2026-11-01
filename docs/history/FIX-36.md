## FIX-36 · Old gifts read from history never start journeys (2026-10-12)

`historyGifts.js` holds the rule: a gift `recordGift` is told came from a history read (`history: true`) and is
dated more than 30 days before the org's today starts no gift journey (first gift, gift over, lapsed return,
next gift, first recurring, membership payment), no sequence and no thank-you draft. Callers: the giving-source
first read (PayPal, Zeffy, Givebutter, Square, Stripe-as-a-source) and QBO-IN's save. QBO-IN's own 30-day
thank-you cutoff moved into the same constant. Behaviour change: a giving source's first read used to draft no
thank-yous at all; it now drafts them for the last 30 days, the same as QBO-IN. The joined-group trigger still
fires from the gift path, because group membership is the donor's state today. Drift and the lapse/drift sweeps
already date every gift by its own date and gate on `created_at`, so they needed nothing. Guard:
`tests/fix36-history.test.js`.
