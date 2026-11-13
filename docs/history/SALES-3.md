# SALES-3 · Close and keep (Part A: close)

**Why.** December's plan: nurture the pilots so six to eight orgs start paying on 1 January 2027,
then sell from referrals. The sales CRM tracked deals but couldn't put a price in writing, get it
signed, start billing on a date, or show which pilot is healthy.

**What Part A built.**
- **A quote is a version on a deal** (`sales_quotes`). Plans and add-ons come from Sales settings
  → Plans (the $299 bundle, from pricing.json's r2500 band, and CRM alone, from r500), editable.
  A price below list needs a reason; the reason stays on the deal and is never on the customer's
  page. A new version supersedes the open ones and stops their links. Once one is accepted the
  quote is settled: change the price in Billing.
- **The link is Jonathan's to send.** "Copy link" makes `/quote/<token>`: a 32-byte random token of
  which only a hash is kept (the referral link's pattern), alive 30 days or until accepted; a new
  link turns the old one off. Steward sends nothing: Copy, or `mailto:` in his own email.
- **What she signs is what she saw.** The page text (the quote's terms, then the customer
  agreement from `customerAgreement.js`) is rendered once when the link is made and its SHA-256
  is kept; Accept and sign sends the hash back and a mismatch is refused. Typed name, title, the
  tick, the time and the IP are kept; the PDF (ONBOARD-1's `agreementPdf`) is made once and kept
  on the quote. The quote's own terms say it governs where it and §2 differ (the first-charge day
  and when the setup fee is charged): §2 says thirty days and a setup fee at signing, a quote says
  its start day and the fee on the first charge.
- **Accepted means set up.** The deal's value becomes the quote's price and it moves to Verbal
  yes (Trial when a Steward org is linked), never backwards. On the linked Steward org: a
  `start_signatures` row (so Settings → Billing shows the signed agreement), then ONBOARD-2's
  paper gate is asked through `startComplete.stampPaperDone`. Paper is still signature AND card:
  signing without a card leaves it waiting, by design (the gate is not loosened here).
- **No charge before the start day.** The subscription is created with `trial_end` at noon on the
  start day in the org's zone (startLink's `firstChargeAt`), an inline price on the band's own
  product, and the setup fee as an invoice item made after the subscription and tied to it, so
  the $0 trial invoice can't sweep it up. `add_invoice_items` would charge today; it is never
  used. The card step is Checkout in setup mode (a SetupIntent); the billing webhook (or the
  page's own POST on return) saves the card, makes it the subscription's, and asks the paper gate.
- **Today and the forecast.** "Billing starts in N days" (within 14) and "Quote sent N days ago,
  not signed" (5 or more). The forecast counts an open deal with an accepted quote in full at its
  price from the month billing starts, and takes it out of the weighted pipeline.

**Planted defects (SALES3_PLANT):** `noreason`, `otherquote`, `chargeearly` (tests/sales3-close.test.js).
