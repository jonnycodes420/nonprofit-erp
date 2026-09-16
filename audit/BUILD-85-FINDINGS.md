# BUILD-85 — THE FOLLOW-UP ENGINE

**2026-09-15.** BUILD-81 built a careful *record* of commitments and half an
engine. This is the other half: ownership, a bounded ranked queue, one morning
email, the ability to look forward, and a number that says whether any of it
works.

Suite: `tests/build85.test.js` (**62**, in `run-all.sh` + `CLIENT_SUITES`).
Decisions still needing Jonathan: `BLOCKED-build85.md`.

---

## What was actually wrong

Read off the code, not off the notes. Each of these was verified in the tree at
`ace6dfd` before anything was changed.

| # | The defect | Where it lived |
|---|---|---|
| 1 | **The nudge sent the same org-wide list to every user.** `composeThreadNudge(orgId, today)` took no user at all, and `runThreadNudgesForOrg` looped every user in the org sending identical bytes. Threads carried `owner_id` and nothing read it. | `server.js:14655`, `:14714` |
| 2 | **No cap, no ranking.** `composeThreads` had no `LIMIT`; Home rendered `threadList.map()` unsliced. Order was overdue-then-due-date, so a $75 thank-you outranked a $40,000 ask one day newer. | `server.js:9612`, `Dashboard.jsx:1539` |
| 3 | **Two morning emails.** `processDailyTaskReminders` and `processThreadNudges` shared the same `inDailyReminderWindow` [6,12) and sent separately, with different scoping rules. | `server.js:14457`, `:14728` |
| 4 | **No way to look forward.** Every opener required something to have already happened. "Call these twenty lapsed donors" had to live in Tasks — which is what kept #3 alive. | all four `openThreadTx` callers |
| 5 | **Nothing measured it.** Drift snapshots `log_capture_rate`; threads snapshotted nothing. The product's central claim was untestable. | `snapshotMetricsForOrg` |

The sharpest irony in the list: **the older, less-loved Tasks reminder already
had the per-officer scoping the flagship system lacked** (`composeDailyTaskReminder(orgId, userId, today)`
filters `assigned_to = ?`).

---

## What was built

### 1 · Ownership — it is one person's list

`composeThreads` and `composeThreadNudge` both take a user now. `scope=mine` is
the default, and **the gate is the server's**: a non-admin asking for
`scope=all` is *downgraded*, not refused — the BUILD-31 pipeline precedent,
because the cross-officer view is the oversight Team sells and staff must not
get it by editing a query param.

**Unowned threads ride the ADMIN's own list.** They are nobody's by definition,
and dropping them would orphan work silently; putting them on every staff list
would recreate the defect. `stat.unowned` is reported separately so the
condition can be fixed rather than tolerated.

The Home scope toggle follows the BUILD-32 standing rule — it appears only for
an admin at a shop with more than one officer, because a picker whose options
all resolve to the same view is clutter.

### 2 · A queue, not a wall — `shared/threadRank.js`

A new pure module. Three rules it is built on, each stated in the file:

1. **Every point is named.** The score is a sum of bounded, individually
   labelled signals, never an opaque weight. A row can always answer "why am I
   looking at this?" because the answer is assembled from the same parts the
   arithmetic used.
2. **Money is relative to the org, never absolute.** Every money signal is
   scored against `majorThreshold` — the org's own p90 of lifetime giving.
   A $5,000 ask is the year for one organization and a rounding error for
   another. *Absolute-dollar ranking is how a CRM starts telling a food pantry
   its work is small.*
3. **The score never reaches the screen.** It orders the list and stops. A
   number on a row invites gaming and reads as invented precision. The UI shows
   the order and the reason.

Signals: `recurring_risk` 34 · `overdue` min(days,21)×3 · `ask_open` 26 +
`ask_size` ≤14 (relative) · `thank_decay` min(days,14)×2 · `first_gift` 22 ·
`major_donor` 18 · `due_today` 8 · `stale` 10. **Bands are facts** —
`overdue` / `today` / `ahead`, read off the due date — deliberately *not* a
"high priority" band, which would require inventing the line where high begins.

`QUEUE_CAP = 12`, `EMAIL_CAP = 10`, and **the remainder is stated, never
hidden**.

### 3 · One morning email — `runMorningBriefForOrg`

The one sender. Both ticks now land in it, and **it reserves BOTH
`digest_sends` ledgers** (`thread_nudge` and `daily_tasks`), so whichever tick
arrives first sends the combined brief and the other finds the reservations
taken. Two timers, one email, and neither idempotency ledger had to be
rewritten.

Both preferences still mean something: opted out of tasks → no task section;
opted out of threads → no thread section; both → no email and nothing reserved.

**The weekend rule moved to where it belongs.** It is the *thread section's*
rule, not the email's: a list of open threads on a Saturday is an intrusion
nobody asked for, but a task the user themself dated Saturday is a commitment
they made. So a weekend brief carries tasks and simply has no thread section.

Admins additionally get a **roll-up** — counts per officer, never everyone's
rows. Oversight is a shape, not a longer list.

### 4 · Planning forward

`POST /donors/:id/threads` and `POST /threads/plan` (a selection, ≤200).

**This does not reopen the tasks battle.** That rule was "logging a
conversation must not require a second step", never "you may not plan". A
planned thread is the same row as any other; its `lastTouch.kind` is `"none"`,
a case `composeThreads` has always handled, and the UI reads it as "Planned".

One open thread per donor still holds. The single route **refuses with 409 and
names the commitment already there**; the bulk route **skips and reports**,
never overwrites — a commitment already made outranks a plan being drawn up.
The partial unique index is the arbiter under a race, so a loser is a skip with
a reason and never a 500.

### 5 · The number the claim rests on

`GET /threads/health` + three metric snapshots (`threads_open`,
`thread_days_to_close`, `thread_continuation_rate`).

**Continuation** is the one that matters: of the threads closed as an outcome,
how many had their closing conversation open the next one. The join *is* the
chain (`b.opening_interaction_id = a.closing_interaction_id`). A rising open
count with a falling continuation rate is a list being cleared, not
relationships being kept, and only this number can tell those apart.

Thin data is said, not smoothed (the BUILD-76 retention rule): a rate over
fewer than five closes is returned `null` with the count beside it, and is
never snapshotted — an artifact would outlive the thinness that made it.

---

## Found by the tests, fixed in the product

**`major_donor` fired on every donor at a young org.** The signal used
`lifetimeGiving >= majorThreshold`. With a uniform donor base — every donor at
$100, which is a young org or a membership — p90 *is* $100, so every donor read
as top-decile and the signal fired on the entire list. **A signal that fires on
everything is noise wearing a signal's clothes.** Now strictly greater: no
spread, no claim. `tests/build85.test.js` §5 produced that donor base by
accident and the assertion failed honestly rather than being loosened.

**The thank-you decay sentence could never reach a screen.** `overdue` scores
3/day and `thank_decay` 2/day *off the same days*, so the generic sentence
always won and the decay line was dead copy pretending to be a feature. Signals
can now declare `supersedes`: the points still count, the superseded sentence
is dropped from the display, and a late thank-you tells its own story.

**The morning report could not tell "clear morning" from "opted out and missing
three overdue threads".** The brief composed *after* checking preferences, so
both came out as `empty`. It now composes first and applies the preference
second, and reports `opted_out` only when a preference actually suppressed
something.

**Em dashes reached an email.** Two rank reasons and the brief's "and N more"
line carried them, against the standing voice rule. `tests/thread-nudge.test.js`
caught it — the guard working exactly as designed.

---

## Reviewed contract changes to existing suites

Both edited deliberately, with the reason written next to the assertion.

- **`tests/thread-nudge.test.js` subject.** `"3 threads open · Marta, day 24"`
  → `"3 waiting on you · Marta, day 24"`. The count is threads *and* tasks now.
  What did not change, because it is the part that does the work, is the
  escalation: the oldest thread, named, with its day number.
- **`tests/thread-nudge.test.js` skip reason.** Its fixture threads carry no
  owner, so under ownership they ride the admin's list and the staff member is
  skipped as `empty` — she genuinely has nothing, whatever her preference says.
- **`tests/notifications.test.js`** needed no edit once the task row said
  `"Due today"` rather than `"Today"` — the existing contract was worth
  preserving over a one-word preference of mine.

---

## Deliberately NOT done

- **`threads_one_open` stays.** One open step per donor is what keeps the list a
  list. Two things owed to one donor is the case for it, not against it, and the
  escape hatch is the step label plus Tasks.
- **Snooze still leaves `due_date` where it was**, so a revisited thread returns
  flagged overdue. Fixing it is a one-line change with a schema question
  attached (does the original due date survive?) and it belongs in its own pass.
  See `BLOCKED-build85.md`.
- **No SLA / escalation-to-manager.** Salesforce-shaped, and it would need a
  policy nobody has set. The roll-up gives an admin the shape; a rule that
  emails a manager when an officer is late is a product decision, not a fill.
