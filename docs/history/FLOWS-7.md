# FLOWS-7 · the first staging night's Tier 1s

Seven numbers and labels from the fleet's first night on staging (lead 2026-11-12) that told a
customer something false. Each was reproduced on staging (Harborlight, read only) or on main
with the new suite before it was fixed; `.claude/reports/FLOWS-7.md` has the table.

- **Pace (Fundraising-04).** `shared/pace.js` let a card sit ten points behind and still say On
  pace, beside its own projection under the goal. The rule moved to `shared/numbers/pace.js`: On
  pace only when the share raised (or committed, named) is at least the share of time gone AND the
  projection reaches the goal; Ahead above that by ten points; otherwise "Behind pace" with the gap
  in dollars. Home reads the server's pace (`/goals/active` now carries it), so the browser no
  longer works it out, and Home states Behind plainly with no alarm colour.
- **Periods (Fundraising-05).** Every money card on Fundraising names its period and dates the same
  way (`shared/displayDate.js periodWords`, `MoneyPeriod`). Board is untouched.
- **Draft links (Fundraising-19).** Not reproduced on staging: the seeded video draft's link opened.
  Built anyway: Drafts to review checks every draft's links and any video claim
  (`server/drafts/linkCheck.js`) and says what is wrong in brass at the top; the seed writes the
  draft's link and the video's token together on a re-run.
- **Audience reasons (Fundraising-16X).** The Overview counted Everyone's people, the editor every
  record not deleted (archived and erased too), and an address with a bounce and a later
  unsubscribe was whichever was newer. One function now (`shared/numbers/audienceReasons.js`), for
  both screens and the send; the suppression list picks bounced, then complained, then the newest.
- **Morning email (Volunteers-19).** Its task list left out next steps and an admin's unowned tasks,
  and its team row counted threads. `shared/numbers/taskDue.js` is Tasks' rule, read by Tasks and
  the email; the email lists every task it counts (twelve, then "and N more").
- **Record a gift From (Volunteers-03X).** A browser datalist over a plain substring search.
  Now the Donors list's person search, on the page, with "+ New person" below the matches and an
  "already on file" question before a duplicate.
- **Starter volunteers (Volunteers-31X).** The starter meant "has a shift"; the rule group and the
  roster meant "has the Volunteer type". The starter is the role rule now; saved copies of the old
  starter are listed by `scripts/ops/flows7-starter-volunteers.js` (dry run) for REPAIR-1.
