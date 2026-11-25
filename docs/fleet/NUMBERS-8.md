# NUMBERS-8 · For the fleet

**Surfaces changed:** Finance → Funds (each fund card's Balance line and the dialog a card opens); Finance → Transactions
(the fund picker now starts on All years); a person's profile rail (a new **Gives through** section) and an
organisation's profile rail (a new **Given through it** section); Fundraising → Overview's LYBUNT chip (the people count
and the households count are separate links) and Reports → LYBUNT (One row per person / One row per household); Home and
Reports → People dashboard (**Gifts not yet thanked since <day>**); Report builder → Gifts → Thanked; the email editor's
preview of a one-person thank-you (Preview as someone who has never given); every figure's dialog when the tab is signed out.

**Clicks to try for the next three nights:**
1. **(Read only, Harborlight.)** Finance → Funds → General Operating. The card's Balance has a line under it ("$… from N
   transactions ($… in, $… out), every year."). Click the card: the dialog's title is the same balance, and its sentence
   says the same N transactions and the same "waiting to post" count and dollars as the card's "… in N gifts not on the
   books yet". There is no "2000 gifts".
2. **(Read only.)** From that card's fund, Transactions → pick General Operating in the fund box: the year box moves to
   All years, and the foot line's net equals the fund's balance. Pick 2026 by hand: the foot says the lines net less and
   names the balance (off the happy path).
3. **(Needs a write: org_stagewalk.)** Make an organisation, give it a $1,000 gift with $400 soft-credited to a person.
   Open the person: Gives through → the organisation, $400; click $400: one row. Open the organisation: Given through it
   → the person, $400. Delete the gift (Undo after): both sections leave, then come back.
4. **(Read only.)** Fundraising → Overview → the LYBUNT chip. Click "465 people": Reports LYBUNT with 465 rows and "One
   row per person" pressed. Back, click "464 households": 464 rows, "One row per household" pressed. Switch Last FY
   first and repeat (the report opens on the chip's year).
5. **(Read only.)** Reports → People → "Gifts not yet thanked since <day>": click it and note the count. Report builder →
   Gifts → filter Thanked is No and Date on or after that day: the same count and total.
6. **(Read only.)** Communications → Templates → Thank you, major gift → Preview as a person who has never given (Ana
   Ruiz-like): the pane says "<First> hasn't given yet. Preview this as someone who has." and a "Preview as <newest
   giver>" link; press it and the letter shows their gift. Never "your gift of your gift".
7. **(Read only.)** Open Fundraising, then in a second tab sign out. Back in the first, click Raised: the dialog says
   "You're signed out in this tab … Sign in again" with a Sign in link, never "No token provided".

**What could have broken nearby:** Finance's Overview fund balances and Monthly breakdown (same ledger rows); Post to the
books and the ledger-status figure (waiting gifts); the Household and related rail section (the org's owner links still
read "Gives through X · $… given through it"); Reports LYBUNT's Save as group (it saves the people either way); the
report builder's Thanked column on saved reports (refund rows now show blank, not No); every template preview "as" a
real person (gift fields come only from that person now).

**Needs a write:** click 3 only (org_stagewalk).
