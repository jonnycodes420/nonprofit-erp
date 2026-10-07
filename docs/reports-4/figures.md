# REPORTS-4 · Every bare number, before

Walked on 7 Oct 2026 against the code at `9a9f82b` (SEARCH-2) and Harborlight. A figure is **bare** when a number
reaches the screen without opening the rows behind it (not a `<Figure source=…>`). The "after" column is filled in
when the build ends; a figure still bare after it names the build that takes it.

## Bare figures

| # | Screen | Figure | Where | Computed now | After |
|--:|---|---|---|---|---|
| 1 | Reports › Giving summary | Unique donors | `Reports.jsx:436,441` | `reportGivingSummary` SQL | |
| 2 | Reports › Giving summary | New donors, Returning donors | `Reports.jsx:436,443` | `reportGivingSummary` SQL | |
| 3 | Reports › Giving summary | Average gift | `Reports.jsx:442` | SQL AVG | |
| 4 | Reports › Giving summary | Median gift | `Reports.jsx:436,442` | SQL PERCENTILE_CONT | |
| 5 | Reports › Giving summary | Online, Offline (amount and count) | `Reports.jsx:444` | SQL filter on stripe_payment_id | |
| 6 | Reports › Giving summary | Monthly table (gifts, total) | `Reports.jsx:450` | SQL by month | |
| 7 | Reports › By fund / campaign / page | each row's total and gift count; the narrative's top total and grand total | `Reports.jsx:462-469` | `reportByGroup` | |
| 8 | Reports › LYBUNT / SYBUNT | the count of people, and "$X at stake" | `Reports.jsx:472-477` | count of rows; at-stake is a client sum | |
| 9 | Reports › Retention | retention %, retained / prior counts | `Reports.jsx:491-502` | `reportRetention` (1 decimal) | |
| 10 | Reports › Retention | dollars retained % | `Reports.jsx:491-502` | `reportRetention` | |
| 11 | Reports › Retention | first-year retention % | `Reports.jsx:491-502` | `reportRetention` | |
| 12 | Reports › Top donors | "top N gave $X" (period and lifetime) | `Reports.jsx:504-506` | client sum | |
| 13 | Reports › Three-year | each year's total and donor count | `Reports.jsx:517-526` | `reportThreeYear` | |
| 14 | Reports › Three-year | year-over-year growth % | `Reports.jsx:519` | `reportThreeYear` | |
| 15 | Reports › Annual | total, gifts, donors, average, growth, new, returning, retention | `Reports.jsx:540-556` | `reportAnnual` | |
| 16 | Reports › Annual | by fund, by campaign | `Reports.jsx:553-556` | `reportAnnual` | |
| 17 | Reports › Bookkeeper | gift count, total | `Reports.jsx:563,585` | `reportBookkeeper` | |
| 18 | Reports › Solicitations | open asks, weighted forecast, officer win rates | `Reports.jsx:590-616` | `reportSolicitations` | |
| 19 | Reports › Week in review | totals sentence, section amounts | `Reports.jsx:636-656` | `/digests/preview` | |
| 20 | Donor profile › Household | household combined, member totals | `DonorProfile.jsx:2448-2461` | `householdView` | |
| 21 | Donor profile › banner | "individually · household total" | `DonorProfile.jsx:2498,3055` | `/donors/:id/relationships` | |
| 22 | Donor profile › Soft credit | their own giving, with soft credit, raised for a page | `DonorProfile.jsx:2510-2525` | `/donors/:id/soft-credit` | |
| 23 | Donor profile › Gifts tab | total, count, by fund, restricted / unrestricted | `DonorProfile.jsx:2410,2639,2996-3022` | client reduce | |
| 24 | Fundraising › giving pages | raised, goal % | `Fundraising.jsx:1052-1062` | `raised_amount` | |
| 25 | Fundraising › overview | raised this period, gifts, donors, vs last | `Fundraising.jsx:371,443-461` | `/fundraising/overview` | |
| 26 | Fundraising › goal thermometers | raised, goal % | `Fundraising.jsx:54,527,601` | `/fundraising/overview` | |
| 27 | Memberships | active / grace / lapsed / cancelled, per-level counts | `Memberships.jsx:199-205` | `byStatus` | |
| 28 | Home › Drift header | "$X at risk · N donors" | `Dashboard.jsx:1675` | `/drift` | |
| 29 | Home › Today rail | open follow-ups, due today, cards failed | `Dashboard.jsx:2669-2676` | thread bands; browser clock | |
| 30 | Home › rail person / drift rows | lifetime, last gift, usual gift | `Dashboard.jsx:1740,2733,2739` | API fields | |
| 31 | Home › Monthly gifts that need you | "$X a month stopped" | `Dashboard.jsx:2899` | browser clock | |
| 32 | Events | "N of capacity taken" | `EventsDesk.jsx:98` | `/events/:id/levels` | |
| 33 | Peer-to-peer | raised, through people, given directly, team raised | `PeerToPeer.jsx:405-428,503` | own breakdown | |
| 34 | Journeys | entered, exited, completed, in it now, on time, late, skipped, gave again | `JourneyBuilder.jsx:994-1004` | private `/journeys/:id/rows`, cut at 1000 | |
| 35 | Tasks | need attention, open, done | `Tasks.jsx:119-121,175` | browser UTC | |
| 36 | Communications | emails sent, open rate, sequences running; campaign stats | `Communications.jsx:2059,2131,2290-2296,2412-2468` | browser `campaignStats` | |
| 37 | Communications › other tool | sends, opens, clicks, gifts | `Communications.jsx:1282-1294` | private endpoint | |
| 38 | Settings › Imports | rows in, gifts created, dollars in | `Settings.jsx:1814-1816` | `/imports` | |
| 39 | Move Report | file vs held lines, by year, top donors | `MoveIn.jsx:320-453` | `/imports/:id/move-report` | |

Already open before this build: the Board and every dashboard (`Dashboards.jsx`), saved dashboards, Auctions,
Campaigns, Grants, the profile header tiles, the giving summary's total and gift count, and every Ask headline.

## Figures that look wrong, not only bare

- **A. Two household totals on one profile.** "Household combined" sums the household's members and leaves out
  deleted people; the "household total" banner sums the spouse and household links and does not.
- **B. Retention counted a refund as giving on Reports** while the dashboard's retention did not, and Reports
  showed one decimal where the dashboard showed a whole percent.
- **C. Communications shows three different "emails sent / open rate" numbers** (the hub reads the six newest
  campaigns, the pills read all of them, "sequences running" reads the five newest).
- **D. A campaign's raised and Reports filtered to that campaign disagree**: raised is net of covered fees, adds
  grants and matches the legacy name; the Reports filter is gross and by id only.
