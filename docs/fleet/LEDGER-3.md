# LEDGER-3 · For the fleet

**Surfaces changed:**
- Finance → Overview: a new card, **Post to the books**, under the Posted / Waiting to post / History only line.
- Finance → Funds: each fund card now reads **Received this fiscal year (gifts)**, then **Balance (books)**, then (when
  there are any) **$X in N gifts not on the books yet**. The org's default fund has a **Default** chip. A line above
  the cards says how many of this year's gifts name no fund, when any do.
- Reports → Gifts by fund (no code change): on Harborlight after the staging re-seed, General Operating is the
  largest fund and Gala Reserve holds one gift.
- Finance → Funds → Merge funds preview (no code change): Gala Reserve into General Operating moves 1 gift, not 4,067.

**Clicks to try for the next three nights:**
1. *(Harborlight, read only)* Reports → Gifts by fund → This FY. General Operating is the largest fund; Gala
   Reserve shows 1 gift. Then Finance → Funds: each fund's "Received this fiscal year (gifts)" is the same dollars
   as its row in Reports, to the cent. Click it: the dialog's rows add up to it.
2. *(Harborlight, read only)* Finance → Funds → General Operating: it has the Default chip, and no other fund does.
   Click the "$… in N gifts not on the books yet" figure: one dialog opens (not the fund's own rows behind it) and
   its rows add up to that figure. Close it, then click the card itself: the fund's ledger rows open.
3. *(Harborlight, read only)* Finance → Overview: Post to the books lists deposits (newest first), each with a gift
   count and total; "Every deposit (N)" matches the number of rows. Nothing is ticked and nothing has posted.
4. **Needs a write (org_stagewalk only):** Finance → Overview → Post to the books → tick one deposit → the button
   reads "Post N gifts ($X)" → press it. The sentence says N gifts posted; Posted grows and Waiting to post shrinks
   by exactly $X; that fund's Balance (books) on Funds grows by exactly $X.
5. **Needs a write (org_stagewalk only), off the happy path:** right after step 4, press **Undo** on the posting
   under Recent postings. The three figures go back to exactly what they were, the deposit is back in the list,
   and a second Undo is not offered. Then tick the same deposit in two tabs and post from both: the second is
   refused ("changed since this list was read"), and nothing posts twice.
6. **Needs a write (org_stagewalk only):** record a gift on a person with no fund chosen. It lands on the Default
   fund (never the first fund by name), and Post to the books does not list it (a gift recorded in Steward posts
   when it is recorded).

**What could have broken nearby:** anything that picks the org's unrestricted fund, now through
`shared/numbers/defaultFund.js`: the gift form's and Log a conversation's default fund, To confirm's proposed fund,
a thank-you draft's "where it's needed most" wording, Atlas's prepared gift plan, demo-tidy's recurring plans,
and `ensureOrgLedger` (every gift's ledger row). The deposit sheet's blank memo still asks unless a person chose a
default. Finance's three ledger figures, a fund's drill-down (TRUTH-3) and Merge funds read the same rows.

**Needs a write:** steps 4, 5 and 6, in org_stagewalk.
