# GIFTS-3 · For the fleet

**Surfaces changed:** a person's Giving tab → + Add Gift (New Gift form) and a gift row's Edit (now the same form);
the Campaign, Appeal and Fundraiser / giving page boxes on both, and on Record a gift (Donors, an event, a grant);
Soft credit, tribute or matching gift (person search boxes); the Method box (Not set, Bank transfer (ACH)); the
Anonymous tick; a gift row's Method column; the giving page editor's preview (The gift → Opens on, Offer a yearly
gift, the amounts, Suggest amounts from your giving); public recent-donor lists; receipts and the bookkeeper export's
Payment method.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Open a person with no gifts → Giving → + Add a gift. Type 123.45, leave Method
   on Not set, type "Spring" in Campaign and do not click anything. The list's one line reads "No campaign called
   'Spring'. Create it?". Press Save: a note says "You typed 'Spring' for the campaign but did not pick one…" and no
   gift is saved. Click the line: the box becomes "Campaign: Spring". Save. The row reads $123.45 and Method "Not set".
2. **(Needs a write.)** On that gift press Edit. The form is the same form: Amount reads 123.45 (never 123.4499…),
   Campaign shows "Campaign: Spring", Appeal and Fundraiser boxes are there, Method reads Not set. Pick Method
   "Bank transfer (ACH)", tick Anonymous, Save. The row says $123.45 and Bank transfer (ACH); the campaign is kept.
3. **(Needs a write.)** Off the happy path: + Add a gift, type 77 and a note, press Cancel, press + Add a gift again:
   the form is empty. Type 66, click the Activity tab, then Giving again: 66 is still there (only Cancel discards).
4. **(Needs a write.)** Edit a gift, open "Soft credit, tribute or matching gift", type part of a person's name in
   Soft credit to: matches show as you type; pick one; Save; the row says "Soft credit to …". Type a name nobody has
   in Who it honors: "Nobody called 'X' is on file." and "Use the name 'X' (not on file)"; pick that. Type a name in
   Soft credit and do not pick: Save refuses with a sentence.
5. **(Needs a write; org_stagewalk has no giving page, so make one.)** Fundraising → a giving page's editor → The gift:
   click Monthly then One-time under Opens on, leave Offer a yearly gift unticked, keep $25/$50/$100/$250. The preview
   at once shows One time first, no Annual, exactly $25 $50 $100 $250 (no $10, no $500). Tick Suggest amounts from
   your giving: above the amounts the preview says "The live page builds amounts from your gifts." Publish, open the
   live page: it matches the preview.
6. **(Read only, Harborlight.)** Any gift row whose method was never given reads "Not set" (never "Needs you"); the
   method list on every gift form has "Bank transfer (ACH)".

**What could have broken nearby:** every gift door that goes through recordGift (a logged conversation's gift, Snap
a check, deposits, imports, Stripe) now stores a blank method as nothing; the Deposits and Month close "banked" rule
(Bank transfer (ACH) counts as banked); the bookkeeper export's Payment method column and its QuickBooks deposit
account mapping; receipts' PAYMENT METHOD; the event page's and a grant's Record a gift; pledge payments recorded
from the rail's Open pledge (the pledge prefill and "This covers…" line); the profile's header figures after an edit;
peer-to-peer and campaign pages' recent donors (an Anonymous gift says Anonymous); a tribute family notice draft.
