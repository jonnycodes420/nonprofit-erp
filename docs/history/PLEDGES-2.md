# PLEDGES-2 · Pledges, recurring gifts and "what they support" behave like a bookkeeper expects (2026-11-07)

From the QA fleet's 7 Nov synthesis (W-1107-*), run in CREO Arts (Demo) on prod.

1. **Payments apply oldest due first (Finance-25X, -20, -20X).** recordGift matched a payment to an
   installment only when the amounts were equal, so $150 on a $100 installment flagged nothing: the
   pledge's paid said $150 while every installment read unpaid. The Giving tab counted every row
   ("4 installments") while the rail counted `unpaidCount` ("3 left"), and Insights' pledge move
   counted unflagged installments by calendar year ("This year's part is $100" after $150 paid). Now
   a payment against a named pledge re-lays the schedule with every payment applied oldest first
   (`server/donors/pledgePayments.js` `relay`, through `pledgeWrite.applyPayments`); a payment above
   the balance is a 409 question (`overBalance`: `extra_gift` writes the excess as its own gift
   through recordGift, `reduce` records the balance). This replaces BUILD-72's "an overpayment is
   silently surplus" for the gift form; other doors (imports) still record surplus. The Giving tab
   says the rail's count; the pledge list re-reads through changes.js. The pledge move reads
   `pledges.js` `dueOf` to the fiscal year end, and Next move re-reads on a change (and once more
   while the stored Insights answer is stale). A move's designation is the gift's restricted fund
   (fundSplit's rule), never a fund named in a memo.
2. **Delete and write-off (Finance-18X, -30X).** A deleted pledge takes its "Pledged" line and its
   open "Open pledges to collect" tasks (when it was the person's only open pledge) into the trash
   row; the timeline says one "Pledge deleted" line; Undo restores both and removes that line. A
   stored Insights move for a pledge that is gone or not open is dropped on read. Write off is a 409
   until `confirmed: true`, the client's confirm names the amount, and an Undo toast reopens it.
3. **Offline recurring plans (Finance-24, -23).** `offline_recurring_plans` and `gifts.offline_plan_id`
   (`server/donors/offlinePlans.js`): create, add a payment (recordGift), turn gifts on file into
   payments, Behind when a payment is more than 7 days late, Cancel asks. Labelled "Recorded by staff
   · offline"; the Stripe plan card reads "Card on file · Stripe".
4. **What they support (Finance-01X).** The server read was already scoped by donor. The client
   loaded the panel only while it was empty and kept no owner; the answer is now tagged with whose
   it is, dropped when it lands for someone no longer on screen, and cleared on a switch. Not
   reproduced locally on main: Donors.jsx remounts the profile per person.

Tests: `tests/pledges2.test.js` (58 checks), red on main (33 failed) and on the planted defect
(relay skipped: §1 red). `tests/pledge-math.test.js` §3/§4 and the write-off call follow the new rules.
