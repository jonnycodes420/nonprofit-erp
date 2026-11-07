# HISTORY-1 · Year over year

HOME-6 left this undone: Steward showed Lifetime and this year, never the years between, and a
development director's first question about a donor is how their giving has changed year to year.

- One home for the rule: `shared/numbers/byYear.js`. A person's years are Lifetime cut by fiscal
  year (money.js and AFTER_IMPORT, so a gift an import's stated total already covers is in no
  year). The stated total is one row, "Before Steward", never spread. Undated, future-dated and
  too-old gifts each get their own row, so the rows always add up to Lifetime.
- The org's years are the Giving summary's (`gifts` and `givers` sources over each fiscal year).
  Donors split exactly three ways (new, retained, reactivated), so the three add up to donors.
  Retention is retained over the year before's donors.
- The year still running is "so far" and is compared with `orgTime.samePointLastYear` (the same
  day of the fiscal year), the window Reports and the Board already use.
- Every figure opens through new sources in `server/reports/yoySources.js`: `donor-year`,
  `donor-year-soft`, `year-largest`, `yoy-donors` and `yoy-retention`.
- TRUTH-1's key gained `byYearById` / `yearsFootLifetime`: year totals sum to lifetime.
- The calendar-year "Giving by year" chart on the profile is replaced by the fiscal By year view.
