## FLOWS-3 · journeys, events, volunteers and meetings behave the way staff expect (2026-11-08)

- **Reproduced first, on a production build.** Each item was driven with real clicks (Playwright) against `NODE_ENV=production` and the built client, on main and on the branch side by side, before anything changed. `tests/flows3.test.js` is that walk kept as a suite.
- **Only an Active journey starts people.** SENDS-1 had listed Draft and Paused journeys as pickable ("Paused: they still start"), because the by-hand path was told to skip `journey_enabled`. Staff read "Paused" as "nobody goes in". Now Draft and Paused are greyed out with the reason, every by-hand door refuses them, and the start path itself refuses them as well (`shared/journeyStartRule.js`).
- **A dated journey counts from its date.** A by-hand start always counted from today, so a Dec 1 journey's first step was due on Nov 10. `journeyAnchor` gives the day the sweep would have used (the next Dec 1, or this person's birthday start), and the preview says "First step Dec 1".
- **A breakdown, never a bare "All 3 can start".** The bulk dialog's rows and preview say "2 can start, 1 is already in it" and list each person.
- **The next gift is the last gift plus the usual gap.** FIX-33's usual-year rule moved a twice-a-year giver's next gift to a year after the gift before last, eleven months out. That rule still decides *late*. The date a person reads is `rhythm.js` `nextGift`, and it reads "Due now" once passed.
- **A gift is named with its own fund.** The Upgraded move paired the newest gift's amount with the year's first designated fund. The meeting-note reader gave the open ask's fund to a plain gift.
- **Every renderer applies the no-gift rule.** `emailCompose.subjectFor` skipped it, and that is the real send's subject. "Send me a test" always used a sample $250 gift. Now it reads as the person the preview shows.
- **The volunteer half (a fork in its own worktree, merged before the PR).**
  - The Volunteers drawer read shifts its own way (future only, other statuses). `server/volunteers/personShifts.js` is now the Schedule's read for one person.
  - A typed event guest was a row with no person behind it. It now goes through `server/donors/addPerson.js`, the Add person path, as type "guest". `scripts/ops/flows3-typed-guests.js` repairs the old ones.
  - Email this group is disabled on an empty group.
  - The Calendar uses the Schedule's conflict rule (one person on two shifts at once).
  - "On a shift" date filters count logged hours and use exactly the dates set.
  - Saying No at Over capacity unchecks the person.
  - The meeting wording no longer says a person on it "was not invited".
