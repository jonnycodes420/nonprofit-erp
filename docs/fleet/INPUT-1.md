# INPUT-1 · For the fleet

**Surfaces changed:** a person's Giving tab → Record a gift / Add Gift form and a gift's Edit (the Amount keeps a
minus and says why under it; a date before 1970 or over a year ahead asks first). Donors → Record a gift (same two).
Finance → + Add transaction (a negative amount is refused under the Amount). Donors → + Add (Add person: blank Save,
a counter near 100 characters, a refusal past it). Communications → a campaign's editor and a template's editor
(Subject warns past 60). The giving page editor → Details → The gift → each amount's line. Volunteers → Schedule →
a shift's editor ("Ends the next day (overnight)"). A person's Volunteer hours (Add hours / Edit over 16 hours asks).
Volunteers → Check-in (kiosk) and an event's door check-in (before the day asks). Events → New event (a past date asks).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** A person → Giving → Record a gift → Amount type `-50` → Save. Right: the box
   still shows "-50" and under it "A gift can't be negative. To give money back, refund the gift."; no gift is added.
   Change it to `50` → Save: a $50 gift. Off the path: that gift → Refund $10 → a -$10 refund row appears under it.
2. **(Needs a write.)** Finance → + Add transaction → Money in, Amount `-40`, a description → Save. Right: the same
   sentence under the Amount, the modal stays open, nothing in Transactions. Money out `-5` → "An amount can't be
   negative…".
3. **(Needs a write.)** Fundraising → a giving page → Edit page → Details → The gift → type "Every gift helps" into the
   $25 line slowly, pausing after each space until "Saved" shows. Right: the box and, after a reload, the line read
   exactly "Every gift helps".
4. **(Needs a write.)** Donors → + Add → Save with nothing typed. Right: Full name is outlined and "Type their name. A
   person needs a name to be saved." Type 106 characters: "106 of 100" shows; Save → "That name is 106 characters.
   Keep it to 100 or fewer; nothing was cut." and nobody is added.
5. **(Needs a write.)** A person → Record a gift → $25, date 01/01/1900 → Save. Right: "Is Jan 1, 1900 right?" with
   Change it / Yes, keep it. Change it: the form stays as typed. Then a gift dated 20 days ahead → Save: no thank-you
   draft in To send and no "Send thank-you note" on the Thread today; both appear on the gift's date.
6. **(Needs a write.)** Volunteers → Schedule → a new shift 17:00 to 16:00 → Save. Right: "The shift ends before it
   starts. For an overnight shift, set the end date to the next day." Tick "Ends the next day" → 22:00 to 06:00 saves as
   8 hours. A person on it and on a 01:00 to 03:00 shift the next morning: the week's conflicts count 1.
7. **(Needs a write.)** Volunteers → Check-in → a shift ten days out → tap a name. Right: "This shift is on <day>. Check
   in then, or record hours for that date" with two buttons; "Check in then" writes nothing; "Record hours for that
   date" logs the shift's hours dated the shift's day. A person → Add hours → 24 → asks "That is 24 hours in one
   entry. Is that right?".
8. **(Needs a write.)** Events → New event → a date last month → Create the event. Right: "This date has passed. Record
   a past event?"; Change the date leaves the form open.

**What could have broken nearby:** every door into `recordGift` (imports, Stripe, QuickBooks, Zapier, Atlas: a
negative now throws unless it is a refund row). The outbox (a day-release event names only the held handlers).
Thank-you backlog, the Thread and journeys for scheduled gifts. The volunteer week view, conflicts, shift copy and
move (an overnight shift's end date moves with it), the overlap question on sign-up, check-out, kiosk. The giving page
editor's other Details fields (privacy link, phone). Scheduled-gift totals (unchanged; still counted on their day).
