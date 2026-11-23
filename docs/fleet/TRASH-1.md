# TRASH-1 · For the fleet

**Surfaces changed:** Finance → Funds (each fund's Balance, its rows, Received and Waiting to post); the Finance dashboard
(revenue, fund balances); Finance → Transactions (a trashed person's lines leave the list); Budgets (actuals); the board
report's finance pages. A person's profile → More → Delete donor and Erase this person (now apart, each with one line); the
Delete confirm ("Move … to the trash?") with the receipts question; Donors list → More → Move to trash (the "with gifts" box
names their receipts). Grants → a grant → Delete (the confirm names its gift and pledge, with "Keep them on the funder" and
"Remove them too"); Finance → a transaction's Delete; Volunteers → a volunteer's hours → remove; Journeys → Delete;
Groups → Delete. Settings → Trash (the "Trash (n)" count and the search).

**Clicks to try for the next three nights:**
1. **(Needs a write: org_stagewalk.)** Add a person, give them a $735 gift to any fund (today's date), open Finance → Funds
   and note the fund's Balance. Open the person → More → Delete donor → Move to trash. Finance → Funds: the Balance is
   $735 lower, and Received is $735 lower. Settings → Trash → Restore them: both come back to the cent.
2. **(Needs a write.)** Give a person a gift and press Send receipt (or Make receipt) on it, then More → Delete donor. The
   confirm reads "1 receipt was issued to <first name>. Void it?" with a line saying Restore does not un-void it, and the
   button reads "Void the receipt and move to trash". Press Keep them: nothing moves and the receipt is still live. Press it
   again and say yes: the receipt shows Voided on their record. Restore them from the Trash: the receipt is still voided.
3. **(Needs a write.)** Settings → Trash with three or more people in it: type two letters of one name. The list narrows at
   once. Clear the box: everyone is back. Press Restore on one: the list sentence AND the "Trash (n)" label in the Settings
   menu both drop by one, with no reload.
4. **(Needs a write.)** Off the happy path: Finance → Transactions → delete a transaction you typed by hand. The confirm
   names its amount and says Undo brings it back; press Undo on the toast and the line and the fund's balance return. Try
   to delete a gift's own ledger line (a row with a gift on it): it is refused, "Delete or edit the gift, and its line
   follows."
5. **(Read only, Harborlight.)** Open any person → More: "Delete donor" with "Moves to Trash, can be undone for 30 days.",
   then under its own rule "Erase this person" with "Removes their personal details for good, for a privacy request. Gifts
   stay as anonymous totals."
6. **(Needs a write.)** A grant that is awarded and has a payment: Delete. The confirm says "This grant has a $… gift and a
   $… pledge on the funder's record. Keep them on the funder, or remove them too?". Keep them: the grant leaves the list,
   the funder still shows the gift and the pledge; Undo on the toast brings the grant back with its deadlines and notes.

**What could have broken nearby:** every Finance figure that reads the ledger (fund balances, the dashboard, budgets'
actuals, the month-end check's "the ledger has the month", the board report, the CSV/JSON export's transactions):
a row naming nobody, or a live person, must read exactly as before. A merged person's gifts (the gift moves to the kept
person, so its ledger row still counts). Removals already on removal.js (ticket types, auction items with bids, funds,
campaigns, tags, groups): their confirms and Undo. Journeys' own Undo on the toast after a Delete. Import undo's
"remove them too" (unchanged: it does not ask about receipts).

**Needs a write:** 1, 2, 3, 4 and 6 run in org_stagewalk only. 5 is read only.
