## EVENTS-3 · An event counts the way the guest list does: parties first, people under them (2026-11-01)

Justin's Place's Finding Joy list has 443 rows, a couple who came together one row; Steward counted each person, so
the event page said 252 came where her spreadsheet said 172 (149 gave against 104, 130 came without a gift against
95). FIX-60 decided an event counts giving units. (1) `shared/numbers/events.js`: `eventFigures` groups every list by
party (`COALESCE(household_id, donor id)`, a walk-in by its guest row) and says the people beside it; the guest
predicates and EVENT_GIFT_MATCH moved there from figureSources. The event page, After the event, `/events/:id/rows`,
the Events list and single-event reads, the door, Home's Grow (one move per party) and week's event, Fundraising's lead
card, Ask and the `event-*`/`events-year-*` sources read it; `numbers.eventGuests` and the Events list's own guest
counts are gone. (2) "172 came · 252 people"; a figure opens one row per party ("Kim and Robby King") with its people
under it; "Save as a group" takes all of them. (3) After the event is one tile look, every tile a `<Figure>` (First-time
givers and Sponsors got sources); check-in is the door search with the list folded under it. The Finding Joy key now
matches on every surface: 443 on the list, 422 invited, 219 registered, 172 came, 104 gave, 77 came and gave, 95 came
without a gift, 21 gave without being invited, $124,290 = $45,340 + $78,950. Why SWEEP-2 saw 558: the reader's people
count is persons (443 rows, 114 of them couples and one family of three); its button now says "558 people, 443 on the
list". The new §FJ assertions were 18 red on main. Lesson: a figure source that returns parties has to carry its
people all the way to every consumer that turns rows back into person ids (the group save found it on the walk).
