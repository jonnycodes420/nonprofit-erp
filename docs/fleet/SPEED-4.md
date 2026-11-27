# SPEED-4 · For the fleet

**Surfaces changed:** Reports → SYBUNT, Annual, Three-year, Year over year (and Giving summary, whose stored answer
now names the tables it reads). The numbers are unchanged; three-year and year-over-year are now stored answers, and
every stored report is recomputed a moment after a gift instead of a few seconds later.

**Clicks to try for the next three nights:**
1. Open each of SYBUNT, Annual, Three-year and Year over year and time the first paint (a stored answer should be
   well under a second; the very first open of the day may compute).
2. **(Needs a write: org_stagewalk.)** Record a gift for a person who gave last year and not this year. Reopen SYBUNT:
   they are gone from it on the first open. Reopen Annual: this year's total and gift count include the new gift on the
   first open (no stale number). Reopen Three-year and Year over year: this year's column includes it too.
3. On each of the four, switch between fiscal year and calendar year: each answer changes to its own year and back.

**What could have broken nearby:** Atlas answers about lapsed donors and giving by year; Home's retention figure; the
board pack (it reads the same reports); the Giving summary report and its figures.

**Needs a write:** the gift-then-reopen check runs in org_stagewalk.
