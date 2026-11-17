# FLOWS-18 · A giving page that says it ended, a starter with a raw tag, and the $55,000 giver who isn't a donor

Six items from lead-2026-11-17 (the sixth staging night). One PR, one new suite (`tests/flows18.test.js`).

## What happened
- **Days left (W-1117-Atlas-01X).** The fleet's exact screen ("0 days left" beside Dec 31; "Ended on Dec 31" with
  "Not open yet") did not reproduce on staging: Campaigns, Giving Pages, the editor's countdown and the public page all
  read 44 days. What was there: four places counted days four ways. The campaign card counted milliseconds from the
  server's clock to UTC midnight, so a goal ending Dec 31 read "Ended" from 7pm Eastern on Dec 30, and `daysLeftText(0)`
  wrote "ended" on an active goal's last day. All of them now read `shared/numbers/endsOn.js`, in the org's civil day:
  the end date is open all day ("Last day"). The exact quote stays OPEN in the report.
- **The starter (W-1116-Fundraising-15X, repeat).** The campaign starters (`shared/emailTemplates.js`) were written for
  the older merge engine and open in the block editor, which fills `{{last_gift_amount}}`, not `{{gift_amount}}`. FLOWS-14
  fixed which gift the old engine read and never noticed the starter reached a different engine. The starters now use the
  block engine's fields; the block engine reads `{{gift_amount}}` as the same gift for drafts already saved.
- **Givers who aren't donors (W-1117-Fundraising-01).** Meridian's roles said organisation only; the Donors tab read the
  stored role, the money read the gifts. `shared/numbers/isDonor.js`: marked Donor, or has given. Donor is added on read.
- **The team label (W-1117-Volunteers-30).** The team cards and the rows came from two queries in one request; a move
  between them (the fleet walks staging at once) gives a row a team its card doesn't count. The guess (a row reusing the
  row before's team) could not happen: rows are keyed by id. Cards are now counted from the rows, and a row's team is its
  card's, client and server; a late answer for another campaign no longer paints.
- **The morning email (W-1117-Volunteers-19, a repeat of FLOWS-7/9's id).** The quoted 8am sentence is in no code or help
  article (OPEN). What was there: sentences that assumed the email was on. `shared/morningEmailState.js` now says it.
- **Draft an email (W-1113-Donors-26, third time).** FLOWS-10 passed the About note to the model with DATES-1's
  instruction, "for tone only; do not quote it or state any of it", and its template named a gift or a conversation,
  never the note. FLOWS-12 did not touch the draft. Both paths now open with the note's detail (`shared/draftAbout.js`).

## What was learned
- A field name is a contract with one engine. A starter written for one and opened in another passes every test written
  against the first. The guard now reads each template against the engine that renders it.
- Two reads in one response are two moments. A total and the rows it totals come from one read.
- An instruction that forbids the very thing a later brief asks for ("for tone only") outlives the brief that wrote it;
  repeats come from the rule, not the code.
