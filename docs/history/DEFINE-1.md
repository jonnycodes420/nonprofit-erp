# DEFINE-1 · One name, one population, one sentence, everywhere

Six items from Jarvis's 22 Nov sweep (staging Harborlight, prod CREO Arts Demo, a2746ab). One PR, one new suite
(`tests/define1-populations.test.js`). Wave 2.

## What happened
- **Five "lapsed" counts were five populations under one word.** Reproduced on staging with real clicks: Re-engage
  295 (lapse.js reengageSql: 12+ months and Lost, askable), Fundraising "LYBUNT 519 donors and households" (the
  LYBUNT report's household-folded units), Groups "Gave last year, not yet this year" 520 people (LYBUNT, askable),
  a saved Communications "Lapsed" audience (donorStatus.quietIds: Lapsing OR Lapsed), and Atlas's Lapsed (the Lapsed
  tag, deceased out). Each was right; only one pair was defined on screen.
- **The fix is a registry.** `shared/populationWords.js` (browser and server) gives each population an id, the name a
  screen shows, its unit (people or households) and one sentence; `shared/numbers/populations.js` points each id at
  the builder that already holds its rule (lapse.js, bunt.js, isDonor.js, everyone.js, groups.js rules) and counts
  it. Atlas, Re-engage, Fundraising's LYBUNT, the Groups starters and rule groups, and Communications' audiences read
  names and sentences from it and write the sentence under the number (`PopulationCount.jsx`). Where two differ on
  purpose the name says so: "LYBUNT: 520 people (519 households…)", "LYBUNT you can ask", "Lapsed 12+ months".
  `scripts/ci/population-ids.js` (CI's guards job) fails on an id the registry lacks, on a listed surface that stops
  reading it, and on a new population word beside a count with no population named (existing lines baselined).
- **A Donor is someone who has given.** `isDonor.js` IS_DONOR was "marked Donor OR has given", so a person added by hand
  with no gift was a Donor (All donors claimed 66 who never gave). It is now "has given" (the stored totals), and the
  Donors tab, its count, All donors, the breakdowns and the portfolio file follow. The truth checks
  (flows18Checks, flows14Checks) were pinning the old rule and now pin this one.
  Billing's records line (`recordsGap.js`) follows too: its plus is now people whose giving was imported with no gift
  row, not people marked Donor. A campaign to All donors no longer sends to a person who never gave. Twelve suites
  built their fixture donors with a role and no gift (or raw gift rows with no stored totals); they now give them
  imported history or recalc the totals the way `recordGift` does, and the never-givers move to Contacts.
- **Audiences.** Built-ins are registry populations by id with the registry's sentence; the Volunteers screen's own
  group ("has volunteered") is no longer offered as a second "Volunteers" audience (it stays a Group); two records with
  one address are reached once (`audienceReasons`: the earlier record, the other counted as "shares an address").
- **Periods (item 5)** and **refunds (item 6)**: `pace.windowDays` is the one day count; an ended campaign reads
  "Raised 87% of goal"; "overdue" on a pledge is `pledgeSchedule.overdueOf` only; anniversaries are civil dates
  (`shared/numbers/anniversary.js`); refunds are "$X returned" or "N gifts refunded" (`refunds.js`).

## What was learned
A number can be right and still mislead when its name is shared. The name, the unit and the sentence belong to the
population, in one place, and a screen borrows all three or none.
