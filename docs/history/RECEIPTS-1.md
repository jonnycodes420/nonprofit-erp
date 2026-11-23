# RECEIPTS-1 · The donor's address on the donor's receipt, and an in-kind receipt that's right

Three items from Jarvis's 22 Nov sweep (a2746ab). One PR; the receipts suite (`tests/comms2-statement-total.test.js`)
extended, no new suite. Wave 2.

## What happened
- **The org's address in the donor block.** Reproduced on staging: receipt #2026-00027 (Harborlight, "QA Sweep-Test
  Two", no address on file) printed "12 Wharf Street, Salem, MA 01970", the org's receipt address, under the donor's
  name. The cause was worse than the report: `renderReceiptPdf` never printed a donor address at all. The line under
  the name was `snapshot.orgAddress`, on every receipt and statement of every org with a receipt address, whether the
  donor had an address or not. Now the snapshot freezes the donor's mailing address at issue (`donorAddress`,
  `shared/mailingAddress.js`; a household statement takes the primary member's, which is the shared one when they
  share), the donor block prints it or nothing, and the org's address moved into the header band beside the EIN.
- **In-kind drawn like cash.** The same receipt was an in-kind gift with an AMOUNT box of $50.00. Jarvis asked for an
  FMV line; the brief declined it: for non-cash gifts the charity describes the property and the donor determines its
  value (IRS Pub 1771). An in-kind or stock receipt now shows DESCRIPTION OF PROPERTY, DATE RECEIVED, the
  goods-or-services sentence and "Steward does not state a value for donated property. The donor determines its fair
  market value." There is no AMOUNT, and the snapshot carries no amount; `receipts.amount` keeps the org's value for
  drift and reports. New columns `gifts.property_description`, `stock_shares`, `stock_ticker`; a new in-kind gift
  needs a description (or notes), and an older one gets no receipt until it has one.
- **Reissue.** `POST /receipts/:id/reissue` already existed for a receipt whose gift changed (PLEDGES-3, new number).
  With no drift it now hands on to `server/receipts/reissue.js`: void, then the same gift, statement or household
  statement made again as the same number with `-R1` (`-R2` …), made and not emailed. Settings → Tax Receipts →
  Issued receipts has the button and flags each receipt that printed the org's address.
  `scripts/ops/receipts1-org-address-receipts.js` counts the existing ones, read only.

## Not done here (next brief)
- A year-end statement still lists an in-kind gift with its dollar value and counts it in "Total tax-deductible
  contributions". Same rule should apply: list the property, leave it out of the dollar total.

## What was learned
A field named for one party (`orgAddress`) was drawn in the other party's block, and no test read the PDF's layout,
only its numbers. The suite now reads the drawn text in order.
