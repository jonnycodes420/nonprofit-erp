# BUILD-74 — DATE SEAM: the three sites BUILD-72 Part 4 could not see

Found by CI, not by a suite. The BUILD-74 landing-trim merge went red on
`portal` — one assertion, in code BUILD-74 never touched.

## THE DEFECT

`portalDriftAlert` (the BUILD-45 §6.3 wire: a donor cancels in the portal, the
org hears in minutes) writes two things. An audit-derived day-view item, and a
high-priority **task due today** — the thing an officer actually acts on.

```
server.js:18296   localDateKey(new Date())   →  the PROCESS timezone (UTC in prod)
server.js:7942    orgToday(org, today)       →  the ORG's timezone (what /dashboard/today filters on)
```

Two date bases at one seam. Between UTC midnight and the org's midnight —
**20:00–00:00 EDT, four hours every evening** — the task is stamped with
*tomorrow's* org date, and the officer's day view does not show it on the
evening it was created.

That is precisely the save window the wire exists to open. BUILD-45's own alert
body says *"A cancellation the org learns about in minutes is a save
opportunity."* For a third of the working evening, it wasn't.

**Reproduced deterministically**, not inferred: local server rebooted with
`TZ=UTC` while New York was still on the previous civil date → the identical
single failure with the identical payload. CI hit it at 02:19 UTC = 22:19 EDT.

### The fix

One line, routed through the seam the rest of the codebase already uses — and
that line 18450, *in the same file*, already used:

```js
- localDateKey(new Date())
+ orgToday(await orgTz(org.id))          // ORG_TZ_SEAM_OK
```

`portal` 67/0 with the server in UTC, in the window that produced the failure.

---

## WHY THE ENUMERATION MISSED IT

This is the finding that matters. BUILD-72 Part 4 enumerated ~100 date-bounded
sites, committed the count, and shipped a test (`date-seam` §5) designed to fail
when a new one appeared. It missed this. It could not have caught it.

**`scripts/build72-date-audit.js` matches EXPRESSIONS ON LINES.**

So a defective *helper* is exactly one site, forever, at its definition:

| | |
|---|---|
| `server.js:12972` — `now.getFullYear()` inside `localDateKey` | **IS** one of the 97, kind `server_local_year` |
| `server.js:13031` — `processDailyTaskReminders` calls it | invisible |
| `server.js:13049` — `/digests/run-daily` calls it | invisible |
| `server.js:18296` — the portal drift task calls it | **invisible — this was the live bug** |

The pattern was not missing. `localDateKey`'s body matched `server_local_year`
and was counted. What was missing is that **counting the definition tells you
nothing about how many places consume the bad value.** A fourth caller, a
tenth, a fiftieth — `total` never moves, and `total <= BASELINE` can never fire
for this class. Coverage decays at every call site while the number stands
still.

The method asks *"where is the bad expression written?"* It never asks
*"where does the bad value get used?"*

That is the real defect, and it is a defect of **method, not of pattern**.
Widening the grep would not have helped: the grep already hit.

### The re-run, against every date helper

Added `scanHelpers()` to `scripts/build72-date-audit.js` — brace-matched
function bodies, any process-local civil accessor (`getFullYear` / `getMonth` /
`getDate` / `getHours` / `getDay` / `getMinutes`) not routed through the seam,
then every call site of each.

```
10   tainted helpers
72   call sites the line-oriented count CANNOT see   (73 before this fix)

  58  dAgo                         server.js:2920
   4  computeRetentionRate         server.js:21030
   2  allocateReceiptNumber        server.js:5439
   2  runCampaignSend              server.js:9987
   2  localDateKey                 server.js:12971   ← was 3
   1  digestYmd                    server.js:12696
   1  inDailyReminderWindow        server.js:12970
   1  computeMilestoneCandidates   server.js:13395
   1  seedData                     db.js:2243
   0  monthsSince                  server.js:13427
```

**Read the number correctly.** 72 does not correct 97, and the total is not
169. They measure different axes — 97 is *expressions written*, 72 is *values
consumed*. The method's defect was measuring only the first and calling it
coverage. Both numbers are now pinned (`date-seam` §5 and §7).

**And the severity is concentrated, not spread.** `dAgo`'s 58 callers are all
inside `POST /org/load-sample-data` — demo-data generation, where a fake gift
landing a day off near UTC midnight is cosmetic. Stripping that, the real
surface is ~14 call sites across 9 helpers. A raw 72 would overstate this; I am
reporting it ranked rather than as a scare number.

---

## FILED, NOT FIXED — sites 2 and 3

Both are the same class. Neither is in this commit, on Jonathan's explicit
instruction: **site 2 changes when live reminder email lands for real
organisations, and anything that reaches a person is his decision, not a rider
on a landing-page trim.**

**Site 2 — `processDailyTaskReminders` (`server.js:13031`) — LIVE IN PROD.**
Two problems, one function:
- `inDailyReminderWindow(now)` is `now.getHours()` — the process clock. The
  documented "morning window [6,12) local" is therefore **6am–noon UTC**, which
  in production is **2am–8am EDT**. US orgs get their morning task reminder in
  the middle of the night.
- `const today = localDateKey(now)` is computed **once**, then passed to every
  org in the loop regardless of that org's timezone — and it is also the
  `digest_sends` dedup key `day:<today>`. One UTC date, applied to orgs in
  every timezone, as both the task filter and the idempotency key.

**Site 3 — `/digests/run-daily` (`server.js:13049`).** Same basis for the
default `today` on the ops route. Low severity (admin-driven, `{today}`
overridable), same class.

Also surfaced by the re-run and worth a look in that build, unranked here
because I did not trace them: `allocateReceiptNumber` takes the receipt-number
year prefix from the process clock (a receipt issued 20:00–24:00 EDT on Dec 31
gets next year's prefix), and `computeRetentionRate`'s default `year` comes
from the process clock near Jan 1 — the JS year-bucketing itself is a
documented deliberate choice, the *default* is not.

---

## THE GUARD

`tests/date-seam.test.js` §7. Three assertions, all proven to FAIL on the
pre-fix tree and pass on the fixed one.

1. **`call sites of process-clock date helpers: 72, must not INCREASE`** — the
   method fix. A new caller of any tainted helper now fails the suite, which is
   what §5 was supposed to do for this class and structurally could not.
2. **`portalDriftAlert stamps tasks.due through the ORG seam`** — the instance.
3. **`no task INSERT takes its due date from the process clock`** — the near
   neighbourhood.

**These are SOURCE assertions, deliberately.** A behavioural test would only
fail inside the timezone window that produced the bug — which is exactly how
this survived from BUILD-45 through the whole of BUILD-72 Part 4: *the suite
has never run in a timezone where it fails.* A source pin fails everywhere,
always, on any machine, at any hour. The clock cannot make it green.

Comments are stripped before the source assertions — the paragraph explaining
this bug names the defective call, and a guard its own docstring can trip is
not a guard. (It tripped. That is how I know.)
