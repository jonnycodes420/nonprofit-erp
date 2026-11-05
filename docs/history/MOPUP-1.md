# MOPUP-1 · The leftovers from 5 Nov's builds

LEDGER-2, GIFTS-1, POLISH-5, LIST-3 and HOME-6 each left one or two things in "found, not fixed".
This build cleared them before Muse's 5 AM walk.

What changed:
- **Old whole-award income rows.** Before GRANTS-FIX, moving a grant into Awarded (the edit's PUT, or
  POST in Awarded) wrote the whole award to the ledger as income (`stampGrantAward`: source='grant',
  grant_id set, no gift_id). LEDGER-2 stopped writing it, because an award is a pledge and GIFTS-1's
  payments are the income, but rows already written stayed. A $15,000 stamp plus a $10,000 payment read
  $25,000 of income. `scripts/ops/mopup1-award-stamps.js` lists them per org (ids, counts and totals)
  and, with `--apply`, removes them, keeping every removed row whole in one audit row per org
  (`--undo=<audit id>` puts them back). It reads only source='grant' rows with no gift_id; a gift's own
  booking and a treasurer's adopted manual row are never touched. Proven on 7287fab's real edit path:
  $25,000 → $10,000, and a second apply changed nothing.
- **Pre-filled dates.** Insights ("Show again on", follow-up due dates), Finance (Add transaction), the
  Deposit sheet, and the other date fields that fill themselves in (Snap a check, screening, grants
  activity, plan a follow-up, Home, the Ask panel, goal periods, Calendar's fallback, volunteer shifts)
  used `toISOString().slice(0, 10)`, the UTC day, which is tomorrow after 8 PM Eastern. They read
  `orgTodayCivil` / `orgTodayPlus` (`client/src/lib/orgToday.js`). Download file names still carry the
  UTC date; they are not fields a person submits.
- **The move card's "Ask".** The label "Ask" sat over words that already began "Ask $20,000". The label
  (and the "Ask:" prefix in the plan note and the task text) shows only when the words don't say Ask.
- **"0% of lifetime".** A whole percent rounded a real $250 to nothing (or to "1%"). `shared/lifetimeShare.js`:
  under 1% reads "under 1% of lifetime", and 0% only when the amount is $0.
- **Event status.** The stored status was set at "upcoming" and never moved. `shared/eventStatus.js`
  derives what a person reads from the date against the org's day: Upcoming, Today, Past; Canceled
  whatever the date; an event marked completed is Past. The list's Upcoming/Past filter uses it.
- **The demo reseed** command for prod is now in `scripts/README.md` and `docs/needs-jonathan/MOPUP-1.md`.

Test: `tests/mopup1-leftovers.test.js` (20 checks; browser leg pins the page to 9 PM Eastern). On
origin/main e0c376d: 10 failed. Planted: the script without `gift_id IS NULL` removes the decoy row (red).
