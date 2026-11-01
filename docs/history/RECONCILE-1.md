## RECONCILE-1 · Old reports check the rest of Steward, and say where they disagree (2026-10-15)

Before: REPORTS-5 kept an old system's totals beside Steward's and never checked them. A board report
saying $612,400 against Steward's $588,900 told nobody anything, and the giving summary, the Board and
the board pack stood an old report in for "last year" on their own whenever Steward had no gifts.

- `reconcile.js` (root) is the one check. It reads through figureSources (`gifts`, `givers`, `bunt`,
  `retention-window-kept`, the new `qbo-contributions`), so every Steward figure in it opens rows that
  foot. A cause is stated only when it is computed: a fund label with no match (or mapping), people
  with no record (email, then whole name), a gift within 45 days outside the period, soft credits the
  report counts, refunds, matching/credit records Steward counts, a giving source not connected and
  absent from Steward. The rest is "Steward can't tell why; these are the rows on each side."
- Stored in `old_report_checks` (one row per report, replaced). Run on import, on every fix-it step,
  on "Check again", and by the after-change step for the seven gift doors (`GIFT_DOORS`,
  `scheduleRecheck`, coalesced). A GET shows an unstored answer for a report never checked.
- Fix-its are routes under `/old-reports`: add-person (+undo), fund-map, baseline. None writes a gift.
- `historicalGiving(..., { baseline: true })` is the COMPARISON stand-in and needs her click
  (`old_report_baselines`); without it an old report is shown beside, never standing in. Goals'
  `/goals/active` gained `lastYear`.
- Seed: `scripts/seed/reconcile1-mismatch.js` rebuilds Harborlight's 2024 DonorPerfect file from its
  own gifts plus a Boathouse Building Fund ($18,500) and three people Steward lacks ($4,450): $22,950,
  exactly two causes, asserted by the seed.
