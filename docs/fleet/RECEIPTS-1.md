# RECEIPTS-1 · For the fleet

**Surfaces changed:** the receipt PDF and the year-end and household statement PDFs (donor block, header band, the
in-kind and stock gift box); a donor profile → Giving → New Gift and a gift's Edit (Description of property when the
type is In-kind or Stock; Shares and Ticker for Stock); Settings → Tax Receipts → Issued receipts (Reissue, "Printed
your address under the donor's name.", "Property" in place of an in-kind receipt's amount); Settings → Tax Receipts →
the receipt preview.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Open a person with no address → Giving → Add gift → $60, Cash → Save → Send
   receipt (or Receipt) → download the PDF. Under the person's name there is nothing but the gift box: no address. The
   org's address is in the coloured header, after "EIN: … ·".
2. **(Needs a write.)** The same on a person with an address: their street and "City, ST ZIP" under their name. Then
   change their address and download the same receipt again: it still shows the old address (an issued receipt never
   changes).
3. **(Needs a write.)** Add gift → type In-kind, $300, leave Description of property empty → Save: refused with
   "An in-kind gift needs a Description of property". Type "Two boxes of art supplies" → Save → Send receipt → the PDF
   shows DESCRIPTION OF PROPERTY "Two boxes of art supplies", DATE RECEIVED, "No goods or services were provided…" and
   "Steward does not state a value for donated property. The donor determines its fair market value." No AMOUNT and no
   $300 anywhere on it.
4. **(Needs a write.)** Add gift → type Stock, $5,000, Shares 40, Ticker VTI → Send receipt: the PDF names "40 shares of
   VTI", no AMOUNT.
5. **(Needs a write.)** Settings → Tax Receipts → Issued receipts → Reissue on the receipt from 1: the sentence says
   "Receipt #N was voided and reissued as #N-R1. Nothing was emailed…"; the old row reads Voided: Reissued as #N-R1.
   Reissue the new one: #N-R2. Off the path: Reissue on a receipt whose gift amount you just changed still voids it
   and issues a NEW number for the new amount (the PLEDGES-3 line "Gift changed after this receipt").
6. **(Read only, Harborlight.)** Issued receipts: receipts issued before this build carry "Printed your address under
   the donor's name."; none issued after it do.

**What could have broken nearby:** every receipt send (Stripe webhook auto-receipt, Send receipt, Email it, resend),
year-end statement run, household statement, the receipt preview in Settings, the "Gift changed after this receipt"
drift line and its Void and reissue, gift add and edit (all types), the auction's "Record as in-kind gift" (its gift's
notes become the description), Going out's line for a receipt ("Receipt for donated property…").

**Needs a write:** 1–5 in org_stagewalk. 6 is read only.
