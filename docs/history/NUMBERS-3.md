## NUMBERS-3 · One home for every giving number, and TRUTH-1's wrong numbers fixed (2026-11-01)

MAP-1 found each giving number computed in 11 to 14 places; TRUTH-1's key proved several wrong on
screens a real customer uses. This build gives each number one home in `shared/numbers/` (CommonJS,
its own `package.json`, no database at load), moves the callers the brief named onto it, and deletes
the copies.

**The modules.** `money.js` (MONEY: hard credit, refunds off; GIFT: money above zero; LIVE),
`fiscalYear.js` (wraps `orgTime.orgPeriodBounds`; `fiscalYearToDate` stops at the org's today;
`period` for fiscal or calendar screens; the label "Jul 2026 to Jun 2027"), `lifetime.js`,
`givingBetween.js` (never past today), `lastGift.js`, `firstGift.js` (the old system's first gift
counts), `retained.js`, `deposited.js` (TRUTH-1's definition 1, `DEPOSIT_NAME`, one banked-methods
list) and `donorTotals.js` (one core for the portal, the account page and merge fields). Each is
tested by hand in `tests/numbers-home.test.js` (the build's one new test).

**Fixed.** D-3 Ask and Atlas counted credit rows as money and givers (`askEngine` gift set). D-4
Finance's money in counted them. D-6 the bookkeeper's file, the deposits file and QuickBooks' deposit
mode read `deposit_ref`, which only Undo writes, so every deposited gift was "not matched" (all 278
on the real-shaped gift history). D-7 the onboarding count. D-8 Fundraising's Recent gifts listed a
soft credit row. Fundraising's Raised tile ran to the year's end, so a future-dated gift counted;
the giving-page raised summed credit rows. The portal's This year was the server's calendar year and
its Lifetime left out an imported total. `my-stats` had no upper bound. The annual report counted a
refund as giving again. Month close read a second list of banked methods (it now reads Finance's:
check, cheque, cash, bank transfer, ACH).

**One last-gift rule (MAP-1 §2.3).** The stored rollup counted a refund or a credit row as the last
gift; the tags did not. Now the first and last gift are gifts, everywhere. Stored rows catch up on
their next write, or at once with `scripts/once/numbers3-recompute-totals.js` (dry run first), which
Jonathan runs.

**Copies deleted.** `finPeriodBounds` (server.js), `computeRetentionRate`'s `fyOf`,
`donorStatus.windowsFor`'s boundary, `insights.js`'s `fyStart` and `profileStatus.js`'s `fyOf`: the
fiscal-year ratchet went from 12 lines to 1 (the client's Reports picker).

**org_f11giA was the suite, not the app.** fix11-gift-file-import's cleanup deleted tables in one
alphabetical pass with errors swallowed: `donors` failed on the gifts still pointing at it, then
`gifts` went, leaving Cho Lin stored at $77 beside no gifts. Every app path that deletes a gift
(gift delete, import Undo, QuickBooks undo, Stripe refunds, Not a gift, sample data) recomputes through
`donorSummary.js`. The cleanup now takes three passes; journeys3-triggers finishes its raw gifts
through `donorSummary.js`.

What was not moved in the time is one line in `docs/defects.md` (NUMBERS-4).
