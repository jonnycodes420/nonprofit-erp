# Defects found and not fixed

One line each: where, what, severity (P1 wrong number, data loss, sends or breaks; P2 reads or
looks wrong; P3 polish), which build found it, and the build it belongs in. A build that fixes
one deletes its line.

## Finance, Reports, Grants (SWEEP-5, 29 Oct 2026; walk in docs/sweeps/sweep-5/walk.md)

- **P2 · ALL-CAPS labels outside Finance, Reports and Grants.** SWEEP-5 turned them to sentence case on its three screens with one rule (`.no-caps` in `GlobalStyles`); `SectionLabel`, `StartHere` and the inline eyebrows still set `text-transform: uppercase` on Home, Fundraising, Donors and the rest. Suggested: the sweep that owns each area adds `no-caps` to its root, or one build drops the uppercase from `SectionLabel` app-wide and retires the class.
- **P2 · Annual report and 3-year comparison compare a running year with a whole one.** The annual report now says "so far" and "against the whole of FY 2025–26", and points at the Giving summary; the 3-year comparison still prints "a change of -69% year over year" for four months against twelve. Suggested: REPORTS-6, the same-point source the Giving summary uses (`samePointLastYearSource`) for the newest column.
- **P3 · Month close calls day-groups deposits.** "4 deposits, $26,777.61 gross" when nothing has been deposited: the gift detail groups unmatched gifts by the day they were recorded and the sentence calls each group a deposit. Suggested: FIN-2, "4 days of gifts not yet on a deposit".
- **P3 · Budgets are calendar years on a fiscal page.** The picker says "Calendar year" now and is no longer hard-coded to 2023–2026, but a fiscal-year org budgets on the calendar. `/finance/budgets?basis=fiscal` exists on the server; moving to it reinterprets every stored budget row, so it needs a decision and a migration note. Suggested: FIN-2.
- **P3 · Budgets' variance reads "+$0".** A zero variance carries a sign. Suggested: FIN-2.
- **P3 · Grants · Reports: "AWARDED, FY 2026–27" broke across two lines at 1440.** Sentence case shortened it and neither walk org had a grant to draw it after the fix. Suggested: the next Grants build looks with a grant on file.
- **P3 · Figure "?" sits between a count and its noun** ("0 ? grants") on Grants · Reports and the Board. Suggested: the next Figure pass.
- **P3 · Phone, Reports: the rail is a select.** Each report opens by its own URL on a phone and costs 0.6 to 1.7 s locally; not throttled to slow 4G in this walk. Suggested: PERF-3 measures Reports at 390 on slow 4G.
