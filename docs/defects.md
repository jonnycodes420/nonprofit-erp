# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## Events and pledges (SWEEP-4, 29 Oct 2026; walk in docs/sweeps/sweep-4/walk.md)

- **P2 · Pledges from the history import route have no installments.** `POST /donors/import-semantics` (the bulk route for other systems' exports) writes pledges with no schedule, and shell pledges link payments that no installment knows about. Writing installments there changes what Undo and the shell repair see, so it needs the real-shaped check. Suggested: IMPORT-6.
- **P2 · A fresh pledge does not count as activity.** Somebody who pledged $15,000 at the dinner twelve days ago reads Lapsed and Cooling on their profile: status reads gifts only. Suggested: the people sweep.
- **P3 · Two tile looks on After the event.** White figure tiles (Raised … Gave) above cream buttons (Invited … Sponsors) on one card; First-time givers and Sponsors open rows but are not `<Figure>`s with a source. Suggested: EVENTS-3.
- **P3 · Check-in draws every guest on the event page.** 195 rows under the door search; the search is the door, the list could fold. Suggested: EVENTS-3.
- **P3 · The open-pledge banner and the Next move repeat each other.** Both list the same installments on the profile. Suggested: the people sweep.

## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P2 · Annual report and 3-year comparison compare a running year with a whole one.** The annual report now says "so far" and "against the whole of FY 2025–26", and points at the Giving summary; the 3-year comparison still prints "a change of -69% year over year" for four months against twelve. Suggested: REPORTS-6, the same-point source the Giving summary uses (`samePointLastYearSource`) for the newest column.
- **P3 · Budgets are calendar years on a fiscal page.** The picker says "Calendar year" now and is no longer hard-coded to 2023–2026, but a fiscal-year org budgets on the calendar. `/finance/budgets?basis=fiscal` exists on the server; moving to it reinterprets every stored budget row, so it needs a decision and a migration note. Suggested: FIN-2.
- **P3 · Budgets' variance reads "+$0".** A zero variance carries a sign. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Phone, Reports: the rail is a select.** Each report opens by its own URL on a phone and costs 0.6 to 1.7 s locally; not throttled to slow 4G in this walk. Suggested: PERF-3 measures Reports at 390 on slow 4G.
