## HOME-CALM — the corrected Part E (2026-09-29)

FIX-8 Part E added a first thing and folded the rest. It did not take anything
away, and the point of the brief was in its title: HOME-CALM removes, it does
not add. So Home opened with five blocks before the work — an alert box, a
nudge card with a green bar, a heading with a brass rule under it, a counts
line, and a summary paragraph — and then hid the list behind two "Show them"
links. Jonathan named all five and the summary sentence with them. This is that
screen, deleted.

**What is left is the date, First thing, and the list.** First thing is
unchanged: `threadList[0]`, said in a sentence, with the three things you can
do to it. Then the rest of the list is ROWS again — everything overdue and
everything due today — because the list she opens Home for has to be on the
screen. Next week is still one folded line, because next week is not this
morning's work. The band headers came off with the counts line: OVERDUE 4 above
four rows that each state their own age is the same tally in another typeface.
The Dashboard keeps all of it — the bands, the counts, the crossover, the
recurring line — because the board's screen is read once a month by somebody
who wants the sections marked off.

**The stopped card became a row, and that is the part worth keeping.** It was
an alert above everything, carrying a count and naming nobody: "1 card stopped
this month." A stopped card is money that was already moving and quietly
stopped, which makes it the most actionable thing on the screen. It now names
her, says what to do, and takes its place in the list by age. It borrows the
row's shape and none of its controls — there is no thread id, no Done, no
snooze, because logging a conversation is not what fixes a declined card.
`/recurring/exceptions` already returned `donorName`; only the count was being
kept.

**Two defects the browser caught that nothing else would have.** The first was
the TDZ rule for the FOURTH time: `homeCalm` reads `threadAllOpen`, whose
`useState` sat two hundred lines below beside the crossover's fetch. That is
not a lint error, it is a blank Home and "Cannot access 'ys' before
initialization" in a minified bundle. `tdz-scan` had said "15 reads-above" and
was not re-run with `--all`. The second: the demo's stopped card has no
`last_failed_at`, only a `first_failed_at` in July, so the row printed "Today"
— a date nothing in the data supports, on a card that stopped two months ago.
It falls back to the first failure, reads "60 days · stopped", and with neither
date prints no figure at all rather than guessing one.

51 suites green, one known skip (the portal tab, hidden from the CRM). No new
test: this is a screen, and screens are covered by the smoke walk.

Still open, and deliberately untouched: at 390 the Today rail still stacks
first, so the phone opens on three counts before the date. That is BUILD-89's
decision, not Part E's, and it was not on the list.
