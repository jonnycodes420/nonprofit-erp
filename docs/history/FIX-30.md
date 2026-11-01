## FIX-30 · Repair "runs" states, bridge templates, small fixes (2026-10-07)

**The "runs" repair.** `scripts/repair-runs-state.js` reads the Agent's undo ledger and, for every person whose postal state
reads "runs" because of an Agent contact update, restores the value from before the FIRST such write (a later write's
"before" is only the earlier "runs"). Dry run by default; `--apply` writes in one transaction with one audit row per
person (actor `system:scripts/repair-runs-state`); `--undo` reverses exactly what --apply changed. A state somebody
changed after the Agent's write, or a "runs" with no Agent write behind it, is listed and left alone. Prod is
Jonathan's to run (NEEDS-JONATHAN). Test `tests/repair-runs-state.test.js` (the build's one new test).
**Templates.** Before: 13 emails on the EMAIL-1 editor, 5 one-person emails on a plain-text editor, 6 campaign starters
on the campaign builder, 5 printed letters on their own editor. After: 24 on EMAIL-1, 5 letters on theirs. The rule is
in docs/decisions/mail-and-notifications.md. Sends are unchanged: a one-person draft is still text, from the words
saved in the editor (EMAIL-1 already turned a block template into a draft as text).
**Small fixes.** Recaptured read "no gift in the 12 months before the last 12", so a person who gave every October read
Recaptured whenever two gifts fell in the last 12 months; it is now a return after a whole calendar year with no gift.
The Dashboard's Sequences link sent `section`, which App drops; it sends `subtab`. Found, not fixed (next brief):
Groups' "Email this group" sends `audienceId`, which App also drops, so it lands on Overview too.
