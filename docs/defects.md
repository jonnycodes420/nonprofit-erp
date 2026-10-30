# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P2 · The Events list's four numbers do not open.** They are `<Figure>`s with their sentences now, but there is no figure source across events (events this year, came this year, received at events, came of registered), so a click opens nothing. Suggested: EVENTS-3 adds `events-year-*` sources in `figureSources.js` and passes them.
- **P2 · Pledges from the history import route have no installments.** `POST /donors/import-semantics` (the bulk route for other systems' exports) writes pledges with no schedule, and shell pledges link payments that no installment knows about. Writing installments there changes what Undo and the shell repair see, so it needs the real-shaped check. Suggested: IMPORT-6.
- **P2 · A fresh pledge does not count as activity.** Somebody who pledged $15,000 at the dinner twelve days ago reads Lapsed and Cooling on their profile: status reads gifts only. Suggested: the people sweep.
- **P3 · Two tile looks on After the event.** White figure tiles (Raised … Gave) above cream buttons (Invited … Sponsors) on one card; First-time givers and Sponsors open rows but are not `<Figure>`s with a source. Suggested: EVENTS-3.
- **P3 · Check-in draws every guest on the event page.** 195 rows under the door search; the search is the door, the list could fold. Suggested: EVENTS-3.
- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.
