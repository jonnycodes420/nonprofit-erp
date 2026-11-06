# FEEL-1 · No number disagrees, no word reads like code, and Home never jumps

Muse's walk of 6 Nov (112 pass, 12 fail) and ATLAS-4's stop at perf-app's desktop CLS (0.201).

## Home never jumps
The moves deck reads `/insights?view=deck` on its own. Until it answers it is a one-line "Reading your
donors…" box; the deck it becomes is about 1,200 px. When that read came late (a cold server, CI's runner)
everything under it was pushed down at once: the Thread went from y 480 out of view at ~1.5 s (a block moved
off-screen reports a zero rect, which read like it was removed). Now Home draws what sits under the deck once
the deck has its size, drawn or failed (`client/src/lib/movesGate.js`, `HomeMoves onSettled`), with a 6 s
safety so the Thread is never held for good. perf-app has a desktop leg with the deck held 1.3 s late, 10 runs.

## Numbers
- **The $244.** `POST /imports/:id/date-undated`. A file that states a total keeps it as `imported_total`; its own
  undated gifts were counted on top (always "after the import"), so Lifetime was the total plus the gift. Dating
  the gift put it on or before `imported_through`, inside the total, and Lifetime dropped by exactly the gift.
  Rule now (lifetime.js and donorSummary.js, one rule): an undated gift from the import that stated the total
  (`donors.imported_import_id`, new, null on every existing row so nothing moves at deploy) is inside it.
- **Follow-ups vs the Tasks badge.** Different lists: Home counts people with a next step planned, any day; the
  badge counts her tasks due today or overdue. The badge's tooltip now says so.
- **Invalid Date.** `events.date` is a DATE; pg hands it back as a Date and `String(d).slice(0,10)` is "Wed Nov 04",
  stored on the attendance line and read by the browser as 2001. Fixed at the attendance route, at the one
  timeline writer (`timelineLine.js`, always YYYY-MM-DD), and in the timeline's grouping (a bad day reads as the
  day the row was written, or No date). Rows already stored this way are not rewritten.
- **Fund totals.** The fund cards and Finance read once; they now re-read on STALE-1's gift/pledge/fund announcement.
- **One shift count.** The Calendar counted every sign-up; the schedule's footer counts people with a place, role by
  role (sign-ups with no role on a roled shift, and deleted people, are not places). The Calendar reads the footer.
- **CSV lifetime** reads `shared/numbers/lifetime.js`, not the stored `total_giving`.

## A skip only skips its own step
Logging any conversation closed the person's open follow-up as its outcome, skipped or not. A skip now closes
only the follow-up the dialog was opened on (`threadId`), or nothing. `restoreSteps` puts the thread's day back
with its journey step's.

## Words
`shared/giftWords.js`: gift type labels, sequence trigger labels, "Unrestricted (no fund)", the event sentence
("1 came, and nobody gave yet."), no receipt for $0 (and the receipt route refuses one), and the Workflows-recipe
note cut from journey descriptions (stored ones on read).
