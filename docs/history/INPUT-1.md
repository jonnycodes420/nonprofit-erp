# INPUT-1 · Steward never changes what someone typed, and never accepts a date that can't be true

Six items from Jarvis's 25 Nov mega sweep (root causes A and E). One PR, one new suite
(`tests/input-integrity.test.js`), the giving page suite extended with a typing test.

## What happened
- **A negative gift saved as positive.** GIFTS-3 (#501, 23 Nov) made the gift form's amount a text box and stripped
  every character but digits, `.`, `,` and `$` as she typed (`GiftForm.jsx`), so "-50" became "50" with no word.
  Reproduced on staging 87433bc in org_stagewalk with real clicks (field showed "50", a $50.00 gift saved). The server
  already refused a negative on the create route, but in a generic sentence; a gift EDIT took -60 (saved -$60), and
  the ledger's Money in took -40 as typed. Now `server/money/negativeGift.js` is the one refusal: the create and edit
  routes, `recordGift` itself (a negative is a refund, `refundOf`, and only a refund) and the ledger route answer
  "A gift can't be negative. To give money back, refund the gift." The form keeps the minus and says it under the
  amount; Record a gift and the ledger modal say it too (the ledger modal used to swallow every server refusal into
  the console). Before GIFTS-3 the box was `type="number"` and the minus reached the server as typed, so flipped gifts
  can only date from 23 Nov; `scripts/ops/input1-existing-rows.js` counts that window per org.
- **Giving page text lost its spaces.** Reproduced on a local production build of main (staging's login limiter was
  full for the whole session, see the report): the headline, story and photo words kept their spaces, but each
  amount's impact line saved "Everygifthelps". The Details rail drew those boxes from `normalizeDesign`, which squeezes
  and trims every line on every render, so a space typed at the end of a word vanished at once. Now the boxes show the
  draft's own words (`typedDesign`), and the editor's three autosaves take the server's copy back only where it
  changed more than whitespace (`client/src/lib/keepTyped.js`). The ends are still trimmed by the server on save.
- **Add person** saved a blank Save as nothing at all (`if(!newDonor.name)return;`). Now Save marks the field and says
  what is missing; a counter shows near 100 characters; past it Save refuses with the reason, and the server does too
  (`addPerson.js`). On Add person main kept all 106 characters; the 100-character cut the sweep saw is on the public
  checkout (`server/give/checkoutName.js`, `Donate.jsx`), which is outside this brief: next brief.
  Both subject counters (campaign and template editors) warn past 60 with a sentence; they never block.
- **Impossible gift dates.** A gift dated before 1970 or more than a year ahead asks "Is Jan 1, 1900 right?" (Yes,
  keep it / Change it) on the profile's form, its edit and Record a gift. A future-dated gift (already "scheduled",
  TRUTH-6) got its thank-you draft and "Thank" task the moment it was typed. Now the gift.recorded handlers that speak
  to or about the donor (thank-you draft, journeys and the gift's thread, sequences) are held in `gift_day_holds`
  and released on the gift's day by an hourly tick (`server/outreach/giftDay.js`), as a gift.recorded event naming
  only the held steps (`only`, honoured by `outbox.relay`). Totals and the after-change step were never held.
- **Shifts.** `slotHundredths` deliberately wrapped an end before the start as overnight (17:00 to 16:00 = 23 hours),
  and `overlaps` compared minutes on one date, so a wrapped shift overlapped nothing. Now an end at or before the start
  is refused unless the shift has an end date the next day (`volunteer_slots.end_date`, "Ends the next day" in the
  shift editor), and overlap and the conflict count read real spans, across midnight. One hours entry over 16 hours
  asks first (`server/volunteers/longHours.js`).
- **Check-in on the day.** Check-in dated the hours today on purpose (PARITY-3), so a check-in ten days early wrote
  hours that had not been given. Now check-in before the shift's day (or the event's) answers 409 with "This shift is on
  Sat, Dec 5. Check in then, or record hours for that date"; the second choice dates the hours to the shift, and hours
  always carry the shift's date. A door scan before the day writes nothing. A new event dated in the past asks
  "This date has passed. Record a past event?".

## Rows written before this build
`scripts/ops/input1-existing-rows.js` lists, per org and read only: the gift-form window since GIFTS-3, thank-you
drafts waiting for a gift dated after today, wrapped shifts with no end date, check-in hours dated other than their
shift, and negative ledger-only rows. Its one `--apply` (one org) gives wrapped shifts their next-day end date.
