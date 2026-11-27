# IMPORT-11 · For the fleet

**Surfaces changed:** Import a spreadsheet: the preview's "What Steward understood" line for a workbook joined on an ID,
the new **What each sheet is** box (each sheet with People / Gifts / Leave this sheet out, and every sheet set aside
named with its reason), and four new headings: **Over the most one gift can be**, **Far outside the pattern** (Import
them / Set them aside), **Exact copies** (Skip the copies / Import them anyway) and **Dated after today**. The import
receipt (a line for each of the four). The import check page (`/imports/<id>/verify`: its headline, and a "dated after
today" line among the rows that explain the gap). A person's Giving tab (New gift and Edit: over $100,000,000 is refused;
a gift far above the pattern asks "Is this amount right?" with Record it / Go back; a scheduled gift has no Refund
button). The rail's Thank-yous card, Home's "gifts not yet thanked", Acknowledgments' backlog and the Report builder's
Thanked = No (a gift dated after today is no longer waiting for a thank-you). Reports' Giving summary "Scheduled:" sentence.

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Build an .xlsx with four sheets: Read Me (a few lines of text), Donors (Constituent
   ID, First Name, Last Name, Email; 60 made-up people), Gifts (Constituent ID, Gift Date, Amount, Fund; 136 rows keyed by
   the Donors IDs, no name column, then a row "TOTAL" with the sum) and a decoy (Fund, Budget 2026, Owner). Donors →
   Import & tools → Import a spreadsheet → choose it. Right: "A workbook of people and their gifts: 60 people and 136 gifts
   ($X) joined on Constituent ID."; "What each sheet is" names Read Me and the decoy as set aside; the total row is
   checked. Change Gifts to **Leave this sheet out**: the line becomes "A list of people with no gifts" and the button
   drops the gifts. Change it back to Gifts, Import: the receipt says 136 gifts, to the cent, and the Gifts sheet's row
   line says "136 gift rows written + 1 set aside".
2. **(Needs a write.)** A CSV with one row of "$1,000,000,000.00". Preview: under "Over the most one gift can be",
   "row N: over $100,000,000, the most one gift can be in Steward. Set aside." Import: the receipt's footing reads
   "File $1,000,…", never "File $0". Then on a person's Giving tab, New gift, amount 1000000000, Save: refused with
   "This gift is over $100,000,000, the most one gift can be in Steward." and nothing saved.
3. **(Needs a write.)** On a person whose only gift is small (say $123.45), with a gift of $500,000 elsewhere in the org:
   Giving tab → Edit that gift → 10000000 → Save. Right: "Is this amount right? This is 81,000 times their usual gift
   and 20 times the largest gift your org has. Record it?" **Go back** saves nothing (the gift still reads $123.45);
   Edit again → **Record it** saves it. Off the happy path: Edit it back down to $123.45: no question.
4. **(Needs a write.)** A CSV with 10 rows that are exact copies of other rows (same ID, name, amount, date, fund, note).
   Preview: "10 rows are exact copies of another row: row 23 (copy of row 2), …" with **Skip the copies** chosen.
   Import: the receipt says "10 rows were exact copies of another row: skipped." Undo the import, choose the same file,
   press **Import them anyway**, Import: 10 more gifts and the receipt says "imported anyway".
5. **(Needs a write.)** A CSV with a gift dated 2031-01-01 and one about two months out. Preview: "Dated after today: 2
   gifts are dated from <the near date> to Jan 1, 2031, after today." Import. Open the 2031 person: the gift reads
   "Scheduled, Jan 1, 2031, not counted yet", there is **no Refund** button, and the rail has no Thank-yous card for it.
   Reports → Giving summary: "Scheduled: … dated from … to Jan 1, 2031", never "the next Jan 1". Open the import's
   check page: the headline is the file's money, and "2 rows scheduled: dated after today…" explains the gap to the cent.
6. **(Read only, Harborlight.)** Home's "gifts not yet thanked" and Acknowledgments' backlog: the same number as before
   unless Harborlight holds a gift dated after today (then that gift is no longer counted until its day).

**What could have broken nearby:** every reader of a stored amount that used `toCents(x) || 0` now reads it exactly
(`storedCentsOr0`): Major Gifts (pipeline, Top 100, plans), Grants (funders, award balances, reports), the board pack,
Dashboard totals, the donor brief and Atlas lines, the impact report, giving-page cards. The import footing on the
receipt and the Imports list. The thank-you backlog rule (Home, Acknowledgments, the rail, Report builder Thanked = No, and the Groups starter "Gifts waiting for a thank-you").
A workbook with a Donors sheet and a Gifts sheet that both carry names still opens the workbook screen as before.

**Needs a write:** checks 1–5 run in org_stagewalk only. Check 6 is read-only.
