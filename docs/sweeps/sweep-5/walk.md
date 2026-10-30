# SWEEP-5 · the walk: Finance, Reports, Grants

Walked 29 Oct 2026 on the scratch stack (main at 1e383a1), as Allie would, on two orgs:

- **the walk org**: a fresh org with the three real-shaped files imported in order (gift history 287,
  the dinner workbook 106 with the dinner dated 22 Oct 2026, contacts 656). 341 gifts, $616,469.93,
  the same total Atlas gives on the live org. `assertSurfacesAgree` is green on it.
- **the empty org**: a brand-new org with nothing in it.

Each screen at 1440 and 390: every Finance section and part, the year basis toggle both ways, every
report in the Reports rail (41), every Grants tab. Screenshots in the scratchpad (not committed):
`walk-before/` and `walk-after/`. Severity: **P1** wrong number, data loss, sends or breaks;
**P2** reads or looks wrong; **P3** polish. Status after the fixes is at the end of each line.

Timings: every screen drew under 1 s on desktop once the app was loaded (Finance first paint
85 ms after the shell, every report 30–110 ms, Reports landing 0.6–0.8 s). Phone at 390 on the
local stack: 0.6–1.7 s per report by URL. Slow 4G was not throttled in this walk.

## Finance

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 1 | Overview · This month | With imported history and no Stripe: Money in this month $45,340 sits beside Restricted $0, Unrestricted $0, Cash on hand $0, FY Revenue $0, FY Expenses $0, Net surplus $0, a "No money has moved yet" card and a Fund balances list of $0. Nothing says which numbers are giving and which are the ledger; it reads as broken. | P1 | fixed |
| 2 | Overview · This month | FY Expenses $0 is drawn in terracotta, an error colour, when nothing is wrong. | P2 | fixed |
| 3 | Overview · This month | "Your giving history lives in Reports" banner: "…money moving through Steward connect Stripe or log a transaction." A missing full stop runs two sentences together. | P2 | fixed |
| 4 | Overview · This month | "No money has moved yet" sits under a chart of twelve months of gifts: two cards contradict each other, and the empty card is a third of the screen. | P2 | fixed (folded into #1) |
| 5 | Overview · This month | Connect Stripe is offered twice on one screen (the giving banner and the Money in strip). | P3 | fixed (folded into #1) |
| 6 | Overview, all sections | ALL-CAPS labels by CSS on every card ("MONEY IN THIS MONTH", "CASH ON HAND", "FUND ACCOUNTING", "8 WKS", "THE DEPOSIT SHEET", "BEFORE YOU CLOSE …"). | P2 | fixed on Finance, Reports and Grants (one `.no-caps` rule); the rest of the app: defects.md |
| 7 | Funds | The definitions under the fund cards print code keys: "balance.", "inPeriod.", "restrictedBy." | P2 | fixed |
| 8 | Funds | The same fund is drawn twice with two different balances: the card's all-time balance, then "Fund accounting" summing this year's transactions only. | P2 | fixed (the second list is "Manage funds" and carries no balance) |
| 9 | Funds · Budgets | Year picker is calendar years 2023–2026 only, while the page's basis is the fiscal year; there is no 2027 and nothing says which basis the budget uses. Variance reads "+$0". | P3 | half: the picker says "Calendar year" and follows the clock; the basis and "+$0" are in defects.md |
| 10 | Funds · Budgets | Actual YTD $0 on Individual Contributions while $75,291.96 was given this fiscal year: the budget reads the ledger and says so nowhere. | P2 | fixed (one line says Actual is the ledger) |
| 11 | Exports · Month close | "Every check is on a deposit" is ticked, and three lines later "5 gifts not matched to a deposit ($26,777.61)". | P2 | fixed (a gift with no payment method counts: "5 gifts are not on a deposit slip: checks, cash, or gifts that don't say how the money arrived") |
| 12 | Exports · Month close | "4 deposits, $26,777.61 gross" when nothing has been deposited: the day-groups are called deposits. | P3 | left: defects.md |
| 13 | Deposits · Payouts, Exports · Year-end, Audit log | Meet the bar (each says what to do next and links to it). | | |
| 14 | Grants money | Meets the bar on both orgs. | | |
| 15 | Year basis toggle | Switches both ways and the labels follow (FY Revenue / YTD Revenue, FY 2026–27 / 2026). Meets the bar. | | |

## Reports

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 16 | Top donors (period) | "Your top 50 donors gave **$50** this period." The total is the number of people, drawn as money: the `givers` source ignored `measure: "sum"`. | P1 | fixed |
| 17 | Gifts for the bookkeeper | Processing fee and Net columns show the gift's amount ($400 fee on a $400 gift), and their footers add up the amounts: every money column read the row's gross cents. The CSV was right; the screen was not. | P1 | fixed |
| 18 | Gifts for the bookkeeper | Donor ID and Steward gift ID ("d_4520a49fe7", "g_af8c6c46") are on screen: database words. They belong in the file, not the table. | P2 | fixed (on screen; still in the CSV) |
| 19 | LYBUNT, SYBUNT, top-donor lists | Email column says "Not set" for everyone without one (most rows). | P2 | fixed ("No email", muted) |
| 20 | Retention | First row "FY2024 · 0 · 0 · Not set · Not set · 0 · Not set": a year with no prior year drawn as a row of blanks. | P2 | fixed (the row is left out and the sentence says so) |
| 21 | LYBUNT, SYBUNT, Retention, Annual, 3-year, Solicitations | Fiscal years named "FY2026"/"FY2027" here and "FY 2026–27" on the chips, Finance, Fundraising and Grants: two names for one year, and "FY2027" for a year that is Jul 2026 – Jun 2027. | P2 | fixed (one name, `shared/fiscalPeriod.js`) |
| 22 | Annual report, 3-year comparison | "down -69% from FY2026": a double negative, and four months of this year against all of last year. | P2 | fixed on the annual report ("so far", "against the whole of FY 2025–26"); the 3-year comparison: defects.md |
| 23 | Dashboards · Board, Board pack (empty org) | "CHANGE ON LAST YEAR Not set", "RETENTION Not set": every blank figure on every screen says "Not set". | P2 | fixed (a blank figure reads "None yet" and its reason stays under it) |
| 24 | Reports landing | "Meetings by staff member, last 12 months" sits above every report, a table of zeros when nobody has logged a meeting. | P2 | fixed (shown only when there is a meeting to count) |
| 25 | Reports landing (empty org) | "Start here: the people who gave last year" on an org with no people; the giving summary's empty state says "Once gifts land…" with no way to bring them in. | P2 | fixed (the empty state offers Import) |
| 26 | All-time giving | Reports had no all-time total, so nobody could check it against Atlas ($616,469.93). | P2 | fixed (Top donors · Lifetime says the all-time total; equal to Atlas and Fundraising, checked by the smoke walk) |
| 27 | Every other report (lapsed, monthly givers, board giving, solicitations, giving summary, by month, by group, week in review, first-time, pledges, ack backlog, link source, the grants and membership reports, dashboards) | Meet the bar on both orgs, at both widths. | | |

## Grants

| # | Screen | Miss | Sev | Status |
|---|---|---|---|---|
| 28 | Grants · Reports (any org without grants) | Twenty $0 / 0 tiles and three "Not set" with no word on what to do. | P2 | fixed (an empty state that says add a grant or bring in a spreadsheet) |
| 29 | Grants · Reports | "AWARDED, FY 2026–27" breaks as "FY 2026–" / "27" across two lines at 1440. | P3 | not seen after the fix (sentence case shortened it; neither walk org has a grant to draw it): defects.md |
| 30 | Grants · Library | Category labels in capitals (MISSION, HISTORY, …). | P3 | fixed (`.no-caps`) |
| 31 | Grants · Pipeline, Funders, Deadlines | Meet the bar on both orgs. | | |

## After the fixes

Walked again the same way (`walk-after/`, beside `walk-before/`): no line on any of the 224 screens
carries "Not set", "undefined", "NaN", "null", a hole, an ALL-CAPS label, red text, a console error from
the app or an API 4xx/5xx (the only console line is the walk's own blocked service worker).
`assertSurfacesAgree` is green on both orgs; Top donors · Lifetime says $616,469.93 all time, Atlas says
"You raised $616,469.93 ever", Fundraising all time says $616,469.93. Desktop timings unchanged
(every Finance part and report 26 to 110 ms after the shell; Reports landing 0.7 s).

Found 26 misses (3 P1, 18 P2, 5 P3) and 5 lines that meet the bar. Fixed 21; partly fixed 3 (#6,
#9, #22), the rest of each in `docs/defects.md`; left 2 (#12, #29), also there.

## Mechanical guard

`tests/smoke-walk.test.js` now opens every Finance section and part, every report in the rail and every
Grants tab on a real-shaped-style fixture org and an empty one, and fails on a blank interpolation,
"Not set", "undefined", "NaN", "null", an ALL-CAPS label in Finance, a console error, or a 4xx/5xx.
