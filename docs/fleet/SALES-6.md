# SALES-6 · For the fleet

**Surfaces changed:** /ops → Sales → a deal's header (Price tile, ARR, Last touch, the new **Send to sign** row);
the deal's Quote panel ("Send to sign" / "Make a new link", each version's order line); the Deals board card's
subline; Now (a mailbox line under the week bar); Sales settings (the mailbox is first; "Connect your mailbox" when
none is connected); a customer's quote page `/quote/<link>` ("Open your order"); the order page `/start/<link>` for an
order made from a quote (list price on the plan line, "Until <start day>", the customer agreement card); the signed
order PDF and the signed quote PDF (the closing block filled in).

Note: `/ops` is super-admin only, and the staging walker is not one. The `/ops` checks below run locally or by a
super-admin; the `/quote` and `/start` pages are public and can be walked anywhere.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk or local.)** In Sales, make a deal with value $299 linked to an organization that
   has a Steward org and a contact with an email. Quote panel: save version 1 at $149 (reason "beta"), start Jan 1, 2027.
   The Price tile reads "$299/mo deal value" and under it "$149/mo quote sent <today>, not signed", with **Use $149 as
   the deal value**. ARR reads $3,588.
2. **(Needs a write.)** Press **Use $149 as the deal value**: the tile reads "$149/mo", ARR $1,788, and the line under
   the header says "The deal's value is now $149/mo, the quote's price (it was $299/mo)." with **Undo**. Press Undo:
   $299 and the quote line come back. (Off the happy path: Undo twice. The second time there is no Undo link.)
3. **(Needs a write.)** Press **Send to sign**: a link appears, copied, with "Order SW-… made from quote version 1. She
   reads the order, signs, adds a card (nothing charged until Jan 1, 2027), and books setup." Open it in a private
   window: the order shows $149 / month, "List price $299 / month…", "Until Jan 1, 2027", and the customer agreement
   card with **no** "Organization ____ / Signed ____" lines. Press Send to sign again: the first link now says it was
   replaced.
4. **(Needs a write.)** Sign that order (name, title, tick): you're handed the card step. Back on the deal the tile
   reads "$149/mo, signed <today>", the Use button and the Send to sign row are gone, and the Quote panel's version
   says "Signed as an order". Download the signed order PDF from Orders: its last block reads "Organization: …",
   "Signed: <name> (typed online)", "Date: … ET", "Name and title: …", "For Steward Software LLC: Jonathan Atkinson,
   signed on issue".
5. **(Read only.)** With no mailbox connected, a deal's Last touch tile says "Your mailbox isn't connected, so emails
   don't count as touches." and **Connect it in Sales settings.** opens Sales settings with "Connect your mailbox" first.
   Now shows the same line under the week bar.
6. **(Needs a write.)** A deal whose organization has **no** Steward org: the header says "Send to sign isn't ready:
   Link this deal's organization to its Steward org first…". Its old quote link still shows "Accept and sign", with no
   blank signature block above the fields.

**What could have broken nearby:** anything reading `customerPrice.js` (the board's column totals, the forecast, the
scoreboard's MRR, the record page's MRR row); ORDER-1's order page and its Make order on /admin → Organizations (the
order insert moved into `insertOrder`); Settings → Billing → the signed agreement PDF; SALES-3's quote page and Accept
and sign for a deal with no Steward org; Today's "quote sent N days ago, not signed" line (a quote signed as an order
leaves it).

**Needs a write:** checks 1–4 and 6, in org_stagewalk (or locally); check 5 is read only.
