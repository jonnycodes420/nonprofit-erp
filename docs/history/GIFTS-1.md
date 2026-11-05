# GIFTS-1 · A gift can belong to an event, a pledge can be paid in installments, a grant can record its payments

From Muse's walks (4–5 Nov) and a customer. After a $250 gift the event said $0 raised and the giver
"Came, didn't give": the gift form had no Event field and the event page had no way to record one. A
$1,200 pledge "in 4 monthly installments of $300 from Dec 1" could only be entered as one $1,200 payment
due today. And a grant's Received was a number typed into its Edit form: no gift, no ledger, no
reduction of the award pledge ("couldn't see where to put that we had received the money").

What changed:
- **Event gifts.** `gifts.event_id` already existed (IMPORT-3) and `recordGift` already wrote it; no
  form set it. The gift form, a gift's edit, Snap a check's confirm and each deposit line now have an
  optional Event field (`client/src/components/gifts/EventField.jsx`, GET /event-choices, recent first),
  and the event page has Record a gift on the page and in each attendee's menu (prefilled with the
  person and the event, `gifts/RecordGiftDialog.jsx`, which posts to the gift form's own route). The
  attendee's Gift cell says "Came, gave $250" / "Came, didn't give". The importers (sheet import, gift
  history, combined) link a gift whose Event or Campaign column names one event exactly
  (`server/events/eventGifts.js`). The sums are unchanged: Raised, the attendee row and the profile
  read `EVENT_GIFT_MATCH`.
- **Installments.** The pledge writer already took a cadence. The form now offers One payment /
  Installments with a count, how often (weekly added) and a first due date, and shows the schedule
  before saving from the same generator (`shared/depositSheet.js` `generateInstallments` and
  `scheduleWords`). The remainder now rides the last installment, not the first. Editing a schedule
  lays the new plan and re-applies every payment on the pledge oldest first (`pledgeWrite.applyPayments`);
  it used to keep paid rows and add a full new plan beside them, so the schedule summed past the pledge.
  A payment against a named pledge auto-applies only to that pledge's oldest installment. The grant
  award step uses the same schedule form.
- **Grant payments.** Record a payment received (amount, date, method) on the award panel writes a gift
  from the funder on the award pledge through POST /donors/:id/gifts. Received and Remaining read
  `GRANT_RECEIVED` (two hand sums replaced); the Edit form shows Received read-only and the PUT no
  longer writes it. The award sentence and each installment say a part payment as one, from
  `installmentsLeft`. `scripts/ops/gifts1-grant-received.js` turns an old typed Received into the one
  payment it stood for (dry run; --apply through recordGift; a second run writes nothing).

Found in the walk and fixed here: the pledge row said "Due Dec 1, 2026" after Dec 1 was paid; it says
the next installment now. The award sentence read "0 of 1 instalment paid" with $10,000 of $15,000 in.

Found and not fixed (next brief): an event dated in the past can still read "Upcoming" in its badge
when its status was never moved; and once LEDGER-2 books an award's income at award time, a payment
recorded on that award must not book the income again. LEDGER-2's award ledger and this build's
payments meet there.
