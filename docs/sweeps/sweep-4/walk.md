# SWEEP-4 · the walk: Events and pledges

Walked 29 Oct 2026 on the scratch stack (main at 199d99d, after FIX-59), as Allie would, on three orgs:

- **the walk org** (`org_sw4walk`): a fresh org with the real-shaped files imported in order (gift history 287,
  the dinner workbook 106 linked to "Finding Joy Dinner" on Oct 17, contacts 656) and the scrubbed guest list.
  `assertSurfacesAgree` is green on it. Note: the scrubbed guest list was scrubbed with the scrubbed
  *gifts sheet*, not with the dinner workbook, so on this org nobody who came also gave (Came 165, Gave 105,
  "0 who came"). That is the fixtures, not the product, so the figures were checked on a second org.
- **the pair org** (`org_sw4pair`): the scrubbed gifts sheet and the guest list it belongs with, into the same
  dinner. Raised $124,290 = $45,340 received + $78,950 pledged; $104,050 pledged over all years ($25,100 in later
  years); Invited 195 = Registered 165 + Declined 30 + No reply 0; Registered 165 = Came 165 + Said yes, didn't come 0;
  Came 165 = gave 135 + didn't 30; Gave 135 = came 135 + didn't come 0; First-time givers 63. Fundraising's lead card
  says the same sentences; `assertSurfacesAgree` is green.
- **the empty org** (`org_sw4empty`): a brand-new org with nothing in it.

Each screen at 1440 and 390. Screenshots in the scratchpad, not committed: `shots/before/` and
`shots/after/`. Severity: **P1** wrong number, data loss, sends or breaks; **P2** reads or looks wrong;
**P3** polish. The status after the fixes is at the end of each line.

Timings: every screen in this area drew in 0.57–1.04 s from a cold navigation on the local stack (median 0.60 s;
the event page with 195 guests 0.92–1.04 s). Phone at 390 the same; slow 4G was not throttled in this walk.

## Events list (Upcoming, Past, All)

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 1 | Stats strip | Four numbers with no sentence and nothing behind them; ALL-CAPS and Title Case labels ("AVG ATTENDANCE RATE"); the empty org read "0%" for an average of nothing. | P2 | half: sentence-case `<Figure>` tiles, each with its sentence, and "None yet · No guest lists yet" for the empty average. Opening their rows needs sources across events: defects.md |
| 2 | Tabs | Upcoming and Past overlapped (an event left "upcoming" after its day showed in both), and today was London's: after 8pm in New York tonight's event moved to Past. | P2 | fixed |
| 3 | Empty state | "No upcoming events yet", "Create Your First Event", "+ New Event": Title Case. | P3 | fixed ("Nothing coming up", "Create an event", "New event") |
| 4 | New event | Create was live with a name and no date and then did nothing; a failed save was a browser alert(); the default date was London's. | P2 | fixed (it says "Give it a date", the error is on the panel) |

## The event page

| # | Section | Miss | Sev | Status |
|---|---|---|---|---|
| 5 | After the event | **Known miss: the "gave" source counted deleted people.** Already fixed (`event-gave` joins live people since FIX-58). But First-time givers, Sponsors and the Raised rows did count them: delete a giver and Raised fell $10,000 while First-time givers stayed 63 with her in its rows. | P1 | fixed |
| 6 | After the event | First-time givers counted gifts, not people: two gifts on somebody's first day were two first-time givers. | P2 | fixed |
| 7 | After the event | **Known miss: the dinner's figures add up and match Home, Fundraising and Ask.** On the pair org every figure adds up and Fundraising and the truth check agree. Ask did not: "How did the Finding Joy Dinner do?" answered "brought in $45,340" beside a page that says $124,290 raised. | P2 | fixed ("has received $45,340 in gifts, and $78,950 more was pledged there, due within a year of it", both figures opening) |
| 8 | After the event | **Known miss: "PLEDGED · FIRST YEAR" runs into its ? at 1440 and 390.** Confirmed at 1440. | P2 | fixed (the label keeps room for the ?) |
| 9 | Header | **Known miss: the "Completed" badge is low-contrast on the dark header.** Confirmed (emerald on dark green). | P2 | fixed (cream on dark) |
| 10 | Every section | ALL-CAPS labels: AFTER THE EVENT, ADD ATTENDEES, TABLES AND SEATING, CHECK-IN, THE PUBLIC PAGE, ATTENDEES, every tile and table head. | P2 | fixed (`.no-caps` on the area's roots, the rule SWEEP-5 added) |
| 11 | Follow-up tasks | **Known miss: "Create Follow-up Tasks" for everyone at once.** (249 on prod; 165 here.) It counted nothing first, made one task per guest ROW, gave deleted people tasks, made the whole set again on a second press, had no Undo, opened a browser alert() on an error, and asked for a title "Follow up with {{event_name}} attendee". The card said "165 donors attended, create follow-up tasks for each." | P1 | fixed: the modal says "This makes 165 tasks, one for each person who came" before anything is made, never makes a second for somebody with one open, and the result has Undo |
| 12 | Tables and seating | **Known miss: on a past event the card says "9 still without a seat" about guests who didn't come.** On the walk org everybody who came had a seat; planted with one no-show, the chart said "1 still without a seat". | P2 | fixed (a past event's chart is who came: "165 who came sat across 14 tables", Seat everyone is gone, "Came, no seat recorded · 0") |
| 13 | Attendees | "Not set" for a guest with no email and no stage; the stage as a database word in capitals ("PROSPECT"). | P2 | fixed ("No email", "Not a donor yet", the stage's name) |
| 14 | Revenue vs cost | "Revenue $45,340" beside Raised $124,290 with nothing saying it is gifts only; cost and a negative net in terracotta. | P2 | fixed ("Received against cost", one sentence, brass) |
| 15 | The public page | **Known miss: while payments aren't connected the page should read "Not open yet", as giving pages do.** It offered Register and "They will be in touch about paying", and the form wrote a guest. | P2 | fixed (the page reads Not open yet with no form, the form refuses, and the editor says why) |
| 16 | Four saves | A failed attendee change, add or event edit opened a browser alert(). | P3 | fixed (a line on the page) |
| 17 | Colors | The no-show badge, the webinar badge and two error lines were terracotta. | P3 | fixed (brass and ink) |
| 18 | Header at 390 | The name wrapped to three lines beside Check-in and Edit Event. | P3 | fixed (the buttons wrap below the name) |
| 19 | After the event | Two tile looks on one card: white figure tiles above, cream buttons below (Invited, Registered, …). | P3 | left: defects.md |
| 20 | Check-in | Every guest is drawn on the page (195 rows) under the door search. | P3 | left: defects.md |
| 21 | Photographs, check-in search, Edit event, the public page editor | Meet the bar. | | |

## Pledges

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 22 | API | **Known miss: a pledge created through the API with no schedule writes no installments.** Confirmed: `POST /donors/:id/pledges` with no schedule answered 201 with `installments: []`; a schedule that did not sum answered 201 too (the error was logged and swallowed); a pledge confirmed in To confirm with one payment, and a matching gift, had none either. | P1 | fixed (one installment of the whole pledge on its due date; a bad schedule is refused before anything is written). Pledges from the history import route: defects.md |
| 23 | Pledges view | Totals $104,050 still to come, $78,950 due this fiscal year, $0 overdue: equal to the rows and to the event page. ALL-CAPS heads. | P2 | fixed (sentence case) |
| 24 | Record a payment | Opens the gift form on the pledge with this installment's amount. Meets the bar. | | |
| 25 | Send a reminder | Drafted the task (nothing sent) but the profile still said "Tasks 0" and "Nothing is open for Wilin"; a second press drafted a second task; no Undo. | P2 | fixed (the profile and the Tasks badge read it at once; the button becomes "Undo the reminder") |
| 26 | Profile | The open-pledge banner and the Next move list the same three installments. | P3 | left: defects.md |
| 27 | Profile | Somebody who pledged $15,000 at the dinner twelve days ago is tagged Lapsed and Cooling: status reads gifts only. | P2 | left: defects.md (status is the people sweep's) |
| 28 | The pledge Review item (To confirm) | One-payment pledges and matching gifts confirmed there had no installments (#22). | P1 | fixed with #22 |

## Tickets & sponsors, Auctions, Peer-to-peer, Memberships

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 29 | Tickets & sponsors | Primary buttons were brass; emerald is the one action colour. | P2 | fixed |
| 30 | Memberships, filled | Expires "2027-10-28": an ISO date in text. | P2 | fixed (Oct 28, 2027) |
| 31 | Auctions, Peer-to-peer, Memberships: empty and one filled example each (an auction for the dinner, "Run for Joy", a Friend level with one member) | Each empty state says what to do next; the filled screens meet the bar after the sentence-case rule. | | |

## After

The walk again after the fixes, same orgs and widths (`shots/after/`): no "Not set", no undefined, no
`{{placeholder}}`, no ALL-CAPS label, and no console error or API 4xx/5xx on any screen in this area (the only
console lines are the local preview's missing `/_vercel/*` analytics stubs). `tests/smoke-walk.test.js` now walks
every screen here on two orgs at both widths and fails on each of those; planting "Not set" back on the attendee
table turned it red (2 failed).
