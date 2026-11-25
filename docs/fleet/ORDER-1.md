# ORDER-1 · For the fleet

**Surfaces changed:** the close link's page (/start/<token>) when it carries an order: "Your Steward
order" with the steps Your details · Review and sign · Card on file · Book your setup, the Sign card,
the card step and the Book your setup step; "Download this order as a PDF"; /admin → Organizations →
"Make order" (was "Create start link") and its order panel (Edit it, Send, PDF); the new "Orders to
sign" card above the Organizations table; /ops → Sales → a deal → the new Orders panel; the deal's
stages Signed and Card on file (added to a pipeline the first time an order needs them); the Terms
page's "Last updated" line (now November 25, 2026, the date §4 changed).

**Clicks to try for the next three nights:**
1. (Needs a write, org_stagewalk) /admin → Organizations → kind filter Fixture (or the walker's kind) →
   org_stagewalk's row → Make order. Type title "Director", price 149, setup "Waived", free days 30, a
   note line. Make the order. Right: "Order SW-2026-NNNN … Nothing is charged when she signs." and a
   /start/ link. Do not press Send unless the signer email is the walker's own.
2. Open that link at 1440 and at 390. Right: the four cards as the mockup; "$149 / month",
   "Waived", "First 30 days … Cancel any time before <today + 30>", "First charge, <same date> $149",
   "Then $149 on the <Nth> of each month"; no sideways scroll at 390.
3. Off the happy path: untick the box, or clear the name. Right: "Sign and continue to card" stays
   disabled. Type a name: the signature line draws it as you type.
4. Off the happy path: keep the order page open, then in /admin press Make order → Edit it, change the
   price to 159 and Save version 2. Back on the open page, tick the box and Sign. Right: the page says
   "This order was updated on <date> at <time> ET. Read the new one and sign it." and shows $159.
5. (Needs a write) Sign it. Right: the card step with "Signed by <name> on <date> at <time> ET." and
   "Nothing is charged until <date>"; Stripe's page (test mode) says nothing is charged today. Do not
   finish Checkout on staging unless the walker's test card is the plan.
6. "Download this order as a PDF" after signing. Right: every line and amount from the page, then
   "Signed by … ET", Terms version 2026-11-25, an IP address and a SHA-256.
7. /ops → Sales → the deal linked to org_stagewalk → Orders. Right: the order, "signed, card not
   saved yet", and "Signed order (PDF)"; the deal's stage is Signed.
8. Off the happy path: /admin → Make order on an org with a signed order → Edit it is not offered;
   making a new one asks to replace, and the new one has a new number.

**What could have broken nearby:** ONBOARD-1's start link without an order (still the old page);
SALES-3's quote page (/quote/<token>, untouched) and the Quote panel; Settings → Billing → the signed
order form (reads start_signatures, which an order also writes); ONBOARD-2's paper gate and the
onboarding board; the billing webhook's checkout.session.completed; the Terms page.

**Needs a write:** steps 1, 4, 5, 7, 8 (org_stagewalk only; never Harborlight).
