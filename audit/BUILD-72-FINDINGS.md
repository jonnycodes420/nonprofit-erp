# BUILD-72 — FINDINGS

Go-to-market readiness. This file is the running record. **Part 0 was written
and committed before a single line of product code was touched** — that is the
point of it, and the rest of the build is only trustworthy because of it.

## Numbering

The brief says "BUILD-66 through BUILD-71 were Kingdom Builders; the last Steward
build was BUILD-65," and asks for the repo's own numbering if it disagrees. It
partly disagrees, in a way worth stating precisely:

- The last Steward **feature** build was indeed BUILD-65.
- But **BUILD-66 was executed in THIS repo** (`553f79d`, `220ab86`, `8ef259c`, …)
  — it was the Kingdom Builders *carve-out*: the identity guard, the boundary
  inventory, and the route/schema separation, all of which are Steward-side edits
  made here. BUILD-67–71 are not in this repo's history at all.
- So `BUILD-72` does not collide with anything and is used as-is.

**Deploy ground truth at Part 0 start** (`node scripts/status.js`):
local HEAD `553f79d` · origin/main `220ab86` · prod backend `220ab86` ·
prod frontend `220ab86`. One pre-existing BUILD-66 commit (`553f79d`, the schema
drop) is **committed locally but unpushed** — it is not BUILD-72's work but it
will ride along on Part 0's push. The Actions-cap deploy block recorded in
`audit/BUILD-66-FINDINGS.md` has cleared: prod backend and frontend both match
origin/main.

**Stack used for every reproduction below:** scratch Postgres 16 on `:5546`
(`steward_loadtest`) + a scratch server on `:5606`, identity-verified before use
(`GET /health` → `product: "steward"`, `database: "steward_loadtest"`). The
Kingdom Builders scratch stack occupying `:5544`/`:5601`/`:5701` was left running
and untouched. Probe scripts: `.b72probe/` (gitignored, not product code).

---

# PART 0 — VERIFY BEFORE FIXING

## Verdict summary

| # | Item | Verdict |
|---|---|---|
| 0.1 | F-4 · import collapsing gift twins | **NOT REPRODUCIBLE** — fixed in BUILD-45. But see 0.1b. |
| 0.1b | *(new)* import silently drops **all gifts** for any donor deduped by email | **CONFIRMED — worse than F-4 ever was** |
| 0.2 | F-3 · manual gift entry idempotency | **NOT REPRODUCIBLE** — fixed in BUILD-45. See 0.2b for the residue. |
| 0.3 | F-5 · pledge fulfillment | **DIFFERENT FROM DESCRIBED** — partials are right; overpayment, status drift and cents are not. |
| 0.4 | `thisWeek` UTC-vs-local | **CONFIRMED — and wider than described** |
| 0.5 | user removal | **CONFIRMED ABSENT** — no route, no control, no plan |

---

## 0.1 — F-4, import collapsing gift twins · NOT REPRODUCIBLE

**Exact input.** `tests/fixtures/build72/twins-matrix.csv` — 98 data rows,
$26,115, columns `Donor Name, Email, Gift Date, Amount`, built to the brief's
matrix exactly:

| Case | Rows | Dollars |
|---|---|---|
| Same donor, same date, same amount, twice (Jane Doe, 2026-03-15, $100) | 2 | $200 |
| Same donor, same date, same amount, ×40 (gala table: Marcus Webb, 2026-03-15, $250) | 40 | $10,000 |
| 40 different donors, same date, same amount (2026-03-15, $100) | 40 | $4,000 |
| Same donor, same amount, adjacent dates (2026-03-15 / 2026-03-16, $100) | 2 | $200 |
| Same donor, same date, different amounts ($100 / $250) | 2 | $350 |
| December 31 cluster (2025-12-31, mixed donors, mixed amounts) | 12 | $11,365 |

Driven through the **real client path** — `lib/importShape.groupTransactions` +
the `submitImportChunked` contract — into `POST /donors/import-combined`.

**Observed.**

```
rows in file: 98        dollars in file: $26,115
server: {created:56, giftsInserted:98, duplicates:0, twinCandidates:40, batchErrors:[]}
DB after import: 98 gift rows, $26,115
>>> ROWS:   in 98 / out 98        BALANCED
>>> DOLLARS: in $26,115 / out $26,115  BALANCED
  case 1 (twins ×2):        2/2 rows, $200/$200      OK
  case 2 (gala table ×40): 40/40 rows, $10,000       OK
  case 3 (40 donors):      40/40 rows, $4,000        OK
  case 4 (adjacent dates):  2/2 rows, $200           OK
  case 5 (diff amounts):    2/2 rows, $350           OK
  case 6 (Dec-31 cluster): 12/12 rows, $11,365       OK
```

**Expected.** Every row a gift; dollars balanced.

**Verdict: NOT REPRODUCIBLE.** F-4 as written in the Aug 8 handoff was fixed by
BUILD-45 and the fix holds. `(donor, amount, date)` is not a dedup key anywhere;
the only gift dedup is an explicit external-ID column, backed by the partial
unique `uq_gifts_external`. Twins are counted into `duplicateCandidates` and
surfaced on the result screen as "N same-day/same-amount twins imported
(reviewable)". **Delete F-4 from the handoff.**

The Part 1 work is therefore *not* "stop collapsing twins" — it is the
reconciliation invariant, which is what 0.1b makes urgent.

## 0.1b — the defect that is actually there · CONFIRMED

Found while building the 0.1 harness. Not in the handoff. Worse than F-4.

**Exact input.** Against the org left populated by 0.1, a second
`POST /donors/import-combined` carrying 2 donors who **already exist** (matched
on email: `jane.doe@b72.test`, `marcus.webb@b72.test`) and 3 new gift rows
totalling **$1,800** (`$500 2026-06-01`, `$600 2026-06-02`, `$700 2026-06-01`).

**Observed.**

```
server: {created:0, giftsInserted:0, duplicates:2, batchErrors:[], duplicateCandidates:{withinFile:0}}
DB delta: 0 rows, $0
>>> SILENT LOSS: 3 rows / $1,800 vanished
```

HTTP 200. The result screen would read *"0 donors added · 2 duplicates skipped"*
— a sentence about **donors** that says nothing whatsoever about the $1,800 of
**gifts** that went in the file and did not come out.

**Expected.** 3 gifts created, $1,800 recorded. The donors are correctly
recognized as already-on-file; their *gifts* are new money and must land.

**Cause** (`server.js:3820-3828`, `3884-3886`): the email-dedup loop only writes
`indexToId[idx]` for donors it inserts. The gift loop then opens with
`const donorId = indexToId[g.donorIndex]; if (!donorId || failedIds.has(donorId)) continue;`
— so every gift belonging to a deduped **or batch-failed** donor is dropped with
no counter, no report and no error.

**Why this is the top item.** It fires on the second import, which is the normal
case: a customer loads donors, then loads gift history; or re-uploads a corrected
file; or imports this month's file against last month's donors. It also fires on
a *batch failure* — one bad row in a 500-donor batch silently takes that whole
batch's gift history with it. This is exactly the class the Part 1 invariant
exists to make unshippable, and it is live today.

**Verdict: CONFIRMED.** Fixed in Part 1.

## 0.1c — `/gifts/import-history` defaults to skip, not keep

Not a defect against the old handoff, but a direct conflict with Part 1's
pre-answered decision, so it is recorded here.

`server.js:5473-5510`: a row with no external ID that matches an **existing**
gift on `(donor, amount, date)` is **held and not inserted** unless the caller
re-submits with `includeDuplicates:true`. It is returned in `heldForReview`, so
it is not *silent* — but the default is **skip**, and Part 1 says the default
selection must be **keep all**. Changed in Part 1.

---

## 0.2 — F-3, manual gift entry idempotency · NOT REPRODUCIBLE

**Exact input.** `POST /donors/:id/gifts`, $100, today's date, replayed the four
ways the brief asks for, using the same `idempotencyKey` the real client sends
(`Donors.jsx:2867` mints a UUID on form open, `:2877` clears it only after a
successful save).

**Observed.**

| Input | Gift rows after |
|---|---|
| double-tap, same key (genuinely concurrent) | **1** ✓ |
| triple-tap, same key (genuinely concurrent) | **1** ✓ |
| tap, wait 2s, tap — same key | **1** ✓ (replay returns `200 duplicate:true` with the original gift) |
| two **different** keys, identical fields | **2** ✓ (legitimate same-day twins still work) |
| double-tap with **no key at all** | **2** ✗ |

**Expected.** One row for a replay; two for two deliberate gifts.

**Verdict: NOT REPRODUCIBLE.** F-3 was fixed by BUILD-45: `gifts.idempotency_key`
+ the partial unique `uq_gifts_idem (org_id, idempotency_key)`, with
`INSERT … ON CONFLICT DO NOTHING` and a replay read (`server.js:4559-4575`). This
is exactly the design Part 2 pre-answers, already shipped. **Delete F-3 from the
handoff.** Part 2's remaining work is the residue below.

## 0.2b — the sibling create paths have no idempotency at all

Part 2 asks explicitly whether the same exposure exists elsewhere. It does.
Two genuinely concurrent identical requests:

| Path | Rows created |
|---|---|
| `POST /donors/:id/pledges` | **2** |
| `POST /donors/:id/interactions` (note / move logging) | **2** |
| `POST /donors` (donor creation) | **2** |

None of the three accepts an idempotency key; the client sends none. A
double-tapped pledge is a **money** row on a finance screen and is the same seam
as the gift fix (same table shape, same partial-unique pattern) — scoped into
Part 2. Interactions and donors are not money and are a different seam
(duplicate-detection/merge already exists for donors) — **scoped to BUILD-73**,
per the brief's instruction not to widen this build.

The keyless gift path (`2` rows) stays reachable by any caller that omits the
key. The DB constraint cannot protect a request that declines to identify
itself; the mitigation is that every first-party client sends one. Recorded, not
fixed — closing it means rejecting keyless creates, which would break the
webhook and portal paths.

---

## 0.3 — F-5, pledge fulfillment · DIFFERENT FROM DESCRIBED

**Exact input.** `$1,000` pledge, then `$100`, then a second `$100`.

**Observed.**

```
created $1,000 pledge          → status open
after 1st $100  stored status=open  paid=$100  API balance=900
after 2nd $100  stored status=open  paid=$200  API balance=800
```

**Expected.** Exactly that.

**Verdict on the handoff item: NOT REPRODUCIBLE.** "Any pledge payment fulfills
the whole pledge regardless of amount" is false. BUILD-45 built
`recalcPledgePayment` (`server.js:4454-4479`): paid is **derived** as
`Σ gifts.amount WHERE pledge_id`, never a stored counter, and every "pledged"
figure in the product reads remaining via `OPEN_PLEDGE_REMAINING_JOIN`.

**But three of Part 3's four decisions are violated, so the verdict on Part 3 as
a whole is DIFFERENT FROM DESCRIBED:**

**(a) Overpayment is swallowed.** A `$1,500` payment against `$800` remaining:

```
paid=$1,700 on a $1,000 pledge → status=fulfilled, balance=0
surplus recorded or flagged anywhere? NO FIELD
```

`recalcPledgePayment` returns `balance: Math.max(0, amount - paid)`. The $700
surplus exists in `gifts` but is invisible on every pledge surface. Part 3
requires it recorded and flagged.

**(b) Status is a stored column with two live drift vectors.** `pledges.status`
is `TEXT NOT NULL DEFAULT 'open'`, recomputed on payment writes but writable
independently through `PUT /pledges/:id` (`server.js:4842-4864`):

```
PUT amount $1,000→$5,000 (paid $1,700) → stored status=fulfilled
    *** DRIFT: fulfilled, with $3,300 outstanding ***   (no recalc on amount change)
PUT status='fulfilled' with $0 paid    → stored status=fulfilled
    *** DRIFT: an independent flag, not a derived value ***
```

Part 3 forbids exactly this. Fixed in Part 3.

**(c) Cents are rounded away on every manual and imported gift.** This is the
finding Part 3 says outranks the rest of Part 3, and it is *not* a float bug:

```
$33.33 gift → stored as 33
column types: gifts.amount = numeric   pledges.amount = numeric   (NOT float — good)
```

Money is `NUMERIC` throughout — the float trap was avoided. But
`Math.round(Number(amount))` is applied on write in the manual gift route, both
import routes, and pledge create/update, truncating to **whole dollars**. Online
gifts through the Stripe webhook *do* carry cents (`db.js:1060-1073` migrated
these columns `integer → NUMERIC` precisely because a $50.50 gift was throwing
and being lost). So the product today stores a $50.50 online gift as `50.50` and
the same $50.50 keyed by hand as `50`. A finance person reconciling a bank
deposit against Steward will be off by the cents on every hand-keyed row.

Recorded here in full. Fixing it touches every money write path and every test
asserting whole-dollar amounts; the decision on whether that lands in Part 3 or
BUILD-73 is stated in Part 3's section of this file when Part 3 runs.

---

## 0.4 — date boundaries · CONFIRMED, and wider than described

**How each boundary is computed, and in what timezone.** There is **no seam**.
`grep` over `server.js` finds **eight** distinct boundary idioms across
**~100 sites**, in **three different timezones simultaneously**:

| Idiom | Sites | Timezone | Views |
|---|---|---|---|
| `weekBounds(offset, now)` `server.js:12085` | 5 | **server-local** (UTC in prod) | Fundraising `thisWeek`, digests, Week-in-Review |
| `monthBounds(offset, now)` `server.js:12092` | 4 | **server-local** | monthly digest |
| `fyStart` (July-1 fiscal year) | 31 | **server-local** | `/dashboard/my-stats`, all three officer breakdowns, both import ledger-stamp gates, Reports FY toggle |
| `CURRENT_DATE` | 10 | **Postgres session tz** | donor stage inference (both imports), pledge overdue, portal campaign windows |
| `digestYmd(new Date())` | 1 | **server-local** | Week-in-Review past-due gate |
| `new Date().toISOString().split("T")[0]` | 18 | **UTC** | `/dashboard/today`, `/dashboard/home`, … |
| `new Date().toISOString().slice(0, 10)` | 21 | **UTC** | receipts, digests, year-end, … |
| `new Date().getFullYear()` | 9 | **server-local** | Reports year default, LYBUNT/SYBUNT year, waterfall |

`organizations.timezone`: **does not exist.** No org-level timezone anywhere in
`db.js`. Every boundary is the server's or Postgres's, never the customer's.

**Reproduction 1 — the same instant, three timezones.** Input: the instant
`2026-03-16T00:30:00Z`, which is **Sunday 2026-03-15 20:30 in America/New_York** —
squarely in the brief's "20:00–23:59 local on a boundary day" window.

```
TZ=UTC (= prod)          weekBounds(0) = {start: 2026-03-16, end: 2026-03-22}   today = 2026-03-16
TZ=America/New_York      weekBounds(0) = {start: 2026-03-09, end: 2026-03-15}   today = 2026-03-15
TZ=Australia/Adelaide    weekBounds(0) = {start: 2026-03-16, end: 2026-03-22}   today = 2026-03-16
```

A gift the customer entered on Sunday evening carries `date = 2026-03-15`. Prod
computes this week as `2026-03-16 … 2026-03-22`. **The gift is not in it.** It is
not in last week either, because by Monday morning prod has moved on. This is the
handoff's `thisWeek` bug, confirmed, with the exact input.

**Reproduction 2 — live, on the day view, captured across a real boundary.**
`/dashboard/today` — the first screen and the whole pitch — computes
`todayStr = new Date().toISOString().split("T")[0]`, i.e. **UTC**
(`server.js:7328`), and uses it for `WHERE t.due <= ?` (`:7437`) and for
`daysOverdue` (`:7598`). For an Eastern org that boundary moves at **20:00 EDT**,
four hours early. Captured live against the scratch stack on 2026-08-29 with two
seeded tasks (one due today-local `2026-08-29`, one due tomorrow-local
`2026-08-30`):

A minute-by-minute sampler ran across the real boundary on the evening of
2026-08-29, reading `GET /dashboard/today` against the scratch stack. Two tasks
were seeded: `t_b72tz_today` (due `2026-08-29`, org-local **today**) and
`t_b72tz_tomorrow` (due `2026-08-30`, org-local **tomorrow**). **Nothing about
the data changed during the run** — only the wall clock moved.

```
local time                UTC       UTC date     today's task: daysOverdue
Sat Aug 29 2026 19:55:58  23:55:58  2026-08-29   0
Sat Aug 29 2026 19:56:58  23:56:58  2026-08-29   0
Sat Aug 29 2026 19:57:58  23:57:58  2026-08-29   0
Sat Aug 29 2026 19:58:58  23:58:58  2026-08-29   0
Sat Aug 29 2026 19:59:58  23:59:58  2026-08-29   0
Sat Aug 29 2026 20:00:58  00:00:58  2026-08-30   1     ← flip
Sat Aug 29 2026 20:01:58  00:01:58  2026-08-30   1
Sat Aug 29 2026 20:02:58  00:02:58  2026-08-30   1
Sat Aug 29 2026 20:03:58  00:03:58  2026-08-30   1
Sat Aug 29 2026 20:04:58  00:04:58  2026-08-30   1
```

**Between 19:59:58 and 20:00:58 EDT — one minute, on a Saturday evening — a task
due today began rendering as "1 day overdue" on the day view.** The org is still
on Saturday. The task is still due Saturday. Only `server.js:7598`'s
`t.due < todayStr` changed its mind, because `todayStr` is UTC.

**Second leg** (`.b72probe/p04d.js`, run at 20:05:44 EDT on its own donor — the
first sampler put both tasks on one donor and `upsertItem` keeps one item per
donor, which masked this):

```
local now       : Sat Aug 29 2026 20:05:44   (org-local date 2026-08-29)
server UTC today: 2026-08-30
task due        : 2026-08-30  (org-local TOMORROW — not yet actionable)
on the day view : *** YES — surfaced, a day early ***
```

Tomorrow's work appears on tonight's list. Both legs, four hours early, every
day, for every Eastern org — on the first screen of the product and the whole
pitch.

**Verdict: CONFIRMED**, and the brief's instruction to find or build the seam
rather than fix `thisWeek` alone is the right call — fixing `weekBounds` would
repair 5 of ~100 sites and leave the day view, the fiscal year, LYBUNT/SYBUNT and
the stage inference wrong in three different directions.

---

## 0.5 — user removal · CONFIRMED ABSENT

**Exact input.** Enumerated every `app.<verb>("…")` in `server.js` matching
user/team/member/staff/invite, and scanned `Settings.jsx`.

**Observed.**

```
Routes touching users/team:
  POST /invitation-request · GET /org/team · POST /auth/invite
  GET /auth/invite/:token · POST /auth/invite/accept
  GET /portfolio/officers · PUT /portfolio/officers/:userId/color
  GET /pipeline/officer-activity
DELETE routes among them:                    NONE
Settings.jsx remove/deactivate control:      NONE
invalidateUserSessions() call sites:         1  (password reset only)
FK constraints referencing users:            0
```

**Expected (for a shipped product).** An admin can remove a teammate, and that
teammate's live sessions stop working.

**Verdict: CONFIRMED ABSENT.** There is no way to remove a user from an
organization — not in Settings, not in the API. `BLOCKED-session-revocation.md`
already states this in as many words: *"A future role-change / removal /
deactivation route MUST call [`invalidateUserSessions`] (there are none today)."*

**What happens to sessions if a row is removed by hand:** `auth.js` returns
`401 user_not_found` on a missing row, and `sessions_valid_after` covers the
revocation case — so the security half is already built and correct. The lag is
the session-cache TTL (30s in prod; 0 in the test boot).

**What is *not* handled:** `users` has **zero** inbound foreign keys, so a raw
`DELETE` succeeds and leaves dangling `donors.assigned_to` /
`donors.assigned_to_name` pointers — removed officers keep appearing on
portfolios and boards by name. Any BUILD-73 removal route must reassign or clear
those, not just delete the row.

**Out of scope for BUILD-72 per the brief. Carried to BUILD-73.**

---

# PART 1 — THE IMPORT RECONCILIATION INVARIANT (and F-4)

Committed as its own change with its fixture and tests. Battery: **105 suites /
0 failed** (up from 104 — the three browser suites now genuinely RUN instead of
skipping; see P1-6).

## P1-1 · The invariant

`importLedger()` in `server.js` is the one seam. Every importer that moves money
keeps a ledger, and every row it touches lands in exactly one bucket:

    rows_in_file    = created + skipped_by_user + errored
    dollars_in_file = created + skipped_by_user + errored

Computed by the importer itself, **asserted before the transaction commits**,
and returned to the client, which renders the arithmetic on the summary screen
under "Every row and every dollar accounted for". A file that does not balance
is refused with **409** naming the discrepancy in dollars, and nothing is
written.

Applied to `/donors/import-combined` (Shape A wide + transaction), to
`/gifts/import-history`, and to `/donors/import` — the donors-only path commits
per batch and is independently recoverable, so there the assertion is a loud
server-side report rather than a rollback, which is stated in the code.

## P1-2 · Abort and roll back, without losing per-batch tolerance

The two money paths now hold **ONE transaction per request** with the assertion
inside it. But `rows_errored` is a legitimate bucket, so a single bad batch must
be survivable *and counted* rather than killing the request — and Postgres
aborts a whole transaction on any statement error. Each batch therefore runs in
its own **SAVEPOINT** (`withSavepoint`): released on success, rolled back to on
failure, its rows counted as `errored`. The final assertion still rolls back
everything.

## P1-3 · 0.1b fixed — a matched donor's gifts land

The dedup now keeps the existing donor's **id** instead of discarding it, so a
matched donor's gifts attach to the record already on file. Part 0's exact
input now lands 3 rows / $1,800 where it previously landed $0.

## P1-4 · Duplicates are surfaced, never resolved — and the default flipped

A potential-duplicate group is same resolved donor + same date + same amount.
Two kinds are detected and returned in `duplicateGroups`: `within_file` twins,
and `matches_existing` (a row matching a gift already on file — the honest
consequence of P1-3, since re-uploading a file now genuinely creates a second
set of gifts). **Default selection is keep-all**; deselection is explicit, by
`skipRowKeys`, and counted as `user_deselected`. Headless or skipped review
creates everything and the summary states how many groups were auto-kept.

`/gifts/import-history` **defaulted to SKIP** before this build (0.1c): a no-ID
row matching an existing gift was held back unless the caller re-sent with
`includeDuplicates:true`. That default is now keep-all. `heldForReview` remains
in the response as an always-empty array so an older client cannot misread the
shape.

## P1-5 · Four reviewed money-contract changes in the existing battery

Each was pinning the *old* behavior, and in three cases pinning the bug itself.
Every one is annotated in place with why it changed:

| Suite | Was | Now |
|---|---|---|
| `import-combined` | "re-run attaches 0 new gifts" | re-run attaches all 6 and flags them; 12 gifts total |
| `import-both` | "re-run attached 0 gifts" | every gift lands, all flagged |
| `gift-idempotency` §F-4 | colliding row HELD, `includeDuplicates` to force | both import; collision surfaced; deselection counted |
| `concurrency` §3 / `concurrency2` §3 | "each gift exactly ONCE" | lands once per file, collision surfaced, both reconcile |

**"Idempotence by data loss is not idempotence."** Every one of those green
assertions was describing the 0.1b bug approvingly.

## P1-6 · `tests/import-reconciliation.test.js` (53 assertions, in run-all)

- The Part 0 fixture matrix, asserting **dollar totals** and per-case counts.
- 0.1b directly: a matched donor's $1,800 must land.
- **The invariant vs a sabotaged importer.** A test-only seam (gated on
  `DISABLE_RATE_LIMIT`, i.e. the scratch/CI boot, never prod) drops rows exactly
  where every real silent-loss bug in this file has lived — after the row was
  seen, with nothing recording where it went. The import must be **refused with
  409, name the gap in dollars, and roll back so completely that not even the
  donor row survives.** A guard nobody has watched fail is a guess.
- The **family**, not one case: group sizes 2, 3, 12 and 40.
- **5,000 rows** (1,000 donors × 5 gifts, $270,600) — reconciles in ~540ms.
- Keep-all by default; deselection explicit and counted in dollars.

Two more harness fixes were needed and are the same class as S-1/S-2:
`empty-states` and `presentation-wiring` skipped unless `client/dist` contained
the literal `localhost:5601`; they now derive the expected origin from `BASE`.
With `client/dist` built against this run's API (and `VITE_ASSET_ORIGIN`, the
override BUILD-59 already documented), **`empty-states` (20), `presentation-wiring`
(36), `landing-reveal` (7) and `portal-visual` (29) now genuinely run.**

## P1-7 · Carried forward, not fixed here

**Cents are still truncated on import.** `Math.round()` on every gift amount
means a $33.33 row stores as $33. The ledger normalizes consistently so the
invariant stays meaningful, and the loss is now **surfaced** rather than hidden:
the response carries `roundingAdjustment` and the summary screen says
"Amounts are stored in whole dollars; $X of cents was rounded off." Deciding
whether money becomes cents-accurate is **Part 3's**, since it touches every
money write path and every test asserting whole dollars.

---

# PART 2 — F-3, IDEMPOTENCY ON MANUAL GIFT ENTRY

**F-3 itself needed no code.** Part 0 established it was fixed in BUILD-45 and
that the fix is exactly the design this brief pre-answers: a client-minted UUID
per form open, a partial unique on `(organization_id, idempotency_key)`, a
replay returning the existing gift with 200, and the key rotating only on a
successful save. Double, triple and delayed taps all yield one row; two
different keys with identical fields still yield two.

So Part 2's work was the residue Part 0 found.

## P2-1 · Pledge creation is now idempotent — the same seam, so it lands here

Finding 0.2b: two genuinely concurrent identical `POST /donors/:id/pledges`
produced **two pledges**. A pledge is a money row on a screen a finance person
reads, and it is the same seam as gifts, so the brief's instruction ("fix it
here only if it is the same seam") applies.

- `pledges.idempotency_key` + `uq_pledges_idem (org_id, idempotency_key)`
  partial unique — identical shape to `uq_gifts_idem`, so legacy and keyless
  rows are untouched.
- `INSERT … ON CONFLICT DO NOTHING RETURNING`, and a replay returns the
  **original pledge with 200 and `duplicate:true`** — not an error the user has
  to interpret in front of a prospect.
- `Donors.jsx` mints `addPledgeIdemRef` on first submit and clears it only on
  success, mirroring `addGift` exactly.

## P2-2 · Deliberately NOT fixed here

`POST /donors/:id/interactions` (note / move logging) and `POST /donors` also
create two rows from two concurrent identical requests. Both are real; neither
is money, and donors already have duplicate-detection and a merge tool. The
brief says to name them and scope them rather than widen this build, so they are
**BUILD-73**.

The keyless gift path also still double-writes — a DB constraint cannot protect
a request that declines to identify itself. Every first-party client sends a
key. Closing it would mean rejecting keyless creates, which would break the
Stripe webhook and portal paths. Recorded, not fixed.

## P2-3 · Tests (in `gift-idempotency`, now 54 assertions)

- Pledges: two **genuinely concurrent** creates with one key → exactly one row,
  both requests succeed, both describe the same pledge, exactly one is the
  replay.
- A different key with identical fields → a real second pledge (a donor making
  two commitments must still work).
- The key is org-scoped: the same key in another org creates normally.
- **The key has no expiry window.** Rather than sleep for five minutes, the
  gift's `created_at` is backdated ten minutes and the key replayed: it returns
  the original and creates no second row. If a time window were ever introduced,
  this replay would fall outside it and the test would fail.

---

# PART 3 — F-5, PLEDGE PAYMENT MATH

Part 0's verdict was DIFFERENT FROM DESCRIBED: the headline claim ("any pledge
payment fulfills the whole pledge") was false — BUILD-45 already derived `paid`
from linked gifts. But three of the brief's four decisions were violated.

## P3-1 · Overpayment is recorded and flagged, not swallowed

`pledges.surplus_amount NUMERIC NOT NULL DEFAULT 0`. A $1,300 payment run
against a $1,000 pledge now leaves it `fulfilled`, balance `0`, **surplus
`$300`, `overpaid: true`** — on the payment's own response, on the pledge list,
and persisted. Every dollar still exists as gifts. Not capped, not rejected.

**A payment against an already-fulfilled pledge used to be REJECTED (400).**
`POST /donors/:id/gifts` filtered `status='open'`. A final payment arriving
after an earlier one completed the pledge is a real event, and the brief says
neither cap nor reject — so `('open','fulfilled')` is now accepted and the extra
becomes surplus. `written_off` is still refused: that is a human decision, and
such a payment belongs on the donor as a plain gift.

## P3-2 · Status is derived, and both drift vectors are closed

`pledgeStatusFor()` is the only thing that decides a stored status, and
`pledgeDisplayStatus()` derives `open` / `partially_fulfilled` / `fulfilled` for
every read. **`partially_fulfilled` is deliberately a DISPLAY state only** —
storing it would give the drift a second place to hide.

| Drift vector (found in Part 0) | Closed by |
|---|---|
| `PUT /pledges/:id` with a new `amount` never recomputed — a fulfilled $1,000 pledge raised to $5,000 stayed "fulfilled" with $3,300 outstanding | the route now **always** calls `recalcPledgePayment` after the write; raising it reopens the pledge and shows the real $4,000 outstanding |
| `PUT /pledges/:id` accepted `status` directly — $0 paid could be stored `fulfilled` | setting `fulfilled` by hand is **refused with 400 `status_derived`** and a message saying to record the payment or write it off |

`written_off` (and lifting it back to `open`) stays human-settable, because it
is a decision rather than a fact. Arithmetic never resurrects it.

## P3-3 · The migration recomputed every existing row

A guarded `UPDATE … FROM (payment totals)` in `db.js` recomputes `status` and
`surplus_amount` for all pre-existing pledges, touching only rows that actually
disagree. Verified after the run:

```
total_pledges | status_drifted | surplus_drifted
           24 |              0 |               0
```

## P3-4 · Money is NUMERIC, but cents are still truncated — the honest state

The brief says a float on this path outranks the rest of Part 3. **There is no
float**: `gifts.amount`, `pledges.amount` and `pledges.surplus_amount` are all
`NUMERIC`, asserted in the suite by reading `information_schema`.

But `Math.round()` on every manual and imported gift means **$33.33 stores as
$33**, while Stripe gifts keep their cents (`db.js` migrated these columns
`integer → NUMERIC` in the first place because a $50.50 online gift was
throwing and being lost). So the same $50.50 stores differently depending on how
it arrived, and a finance person reconciling a bank deposit is off by the cents
on every hand-keyed row.

**Not fixed in this build, deliberately, and this is the one judgment call in
Part 3 I want flagged rather than buried.** Making money cents-accurate touches
every write path (manual gift, both importers, pledges, the ledger stamp,
receipts, the year-end PDF) and every test asserting whole dollars. Doing it
inside a GTM-readiness build — whose thesis is that a half-done money change is
worse than a known one — is the wrong trade. What this build does instead:

- The suite **pins the current truth** (`a $33.33 payment stores as 33`), so a
  future cents fix must come to this line and change it deliberately.
- Part 1 **surfaces** the loss on the import summary: "Amounts are stored in
  whole dollars; $X of cents was rounded off."
- All Part 3 arithmetic is asserted in **integer cents**, never floats, so the
  suite stays correct when the underlying storage becomes cents-accurate.

Recommended as the first item of BUILD-73, ahead of user removal.

## P3-5 · `tests/pledge-math.test.js` (98 assertions, in run-all)

Ladders reaching the amount in **1, 2, 3 and 7** steps, asserting paid, balance,
derived status and zero surplus at every rung; an exact full payment; the
overpayment above; a payment on an already-fulfilled pledge; both drift vectors;
write-off behavior; a pledge that does not divide evenly (1000/3 → 333/333/334,
landing exactly on zero with no phantom surplus); and the column-type check.
Every money comparison goes through `cents()`.

---

# WHAT A PUSH TO `main` ACTUALLY DEPLOYS — answered once, so nobody asks again

Verified 2026-08-29 from the repo, not from memory. **A push to `main` deploys
BOTH surfaces together, gated on a green battery. There is no skew window.**

| Fact | Evidence |
|---|---|
| Vercel git auto-build is **OFF** | root `vercel.json` → `"git": {"deploymentEnabled": {"main": false}}` (pinned by `tests/email-links.test.js` §5) |
| The frontend deploys **only** from CI | `.github/workflows/ci.yml` job `deploy-vercel`, `needs: [test]`, `if: push && ref == main && vars.VERCEL_DEPLOY_ENABLED == 'true'` |
| That flag is live | GitHub Actions variable `VERCEL_DEPLOY_ENABLED = true` |
| The backend deploys **only** from CI | job `deploy-railway`, `needs: [test]`, same `if` minus the flag; Railway's own GitHub auto-deploy is disconnected |
| Both are gated on tests | both carry `needs: [test]`, and `test` runs the full `run-all.sh` battery |
| Both self-verify | each polls prod for its own `$GITHUB_SHA` (`/health.buildSha` for Railway, the `<meta name="build-sha">` for Vercel) with a 5-minute timeout |
| Actions is not capped | last three runs `220ab86`, `8ef259c`, `d69b3ef` all `success` (the BUILD-66 Actions-cap block has cleared) |

**So the sequencing worry in the Part 4/5 brief does not apply here.** A frontend
expecting `organizations.timezone` cannot reach production ahead of a backend
that has the column: the two deploy jobs start from the same green `test` job on
the same commit. The only asymmetry possible is `deploy-vercel` being skipped if
`VERCEL_DEPLOY_ENABLED` were ever unset, which leaves the **backend ahead** — the
safe direction (a new column no frontend reads yet).

**Standing practice for this build:** push after every part, then
`node scripts/status.js` until local HEAD == `origin/main` == prod backend ==
prod frontend before the next part starts.

---

# PART 0 SIDE-FINDINGS — the harness itself

Two defects found while standing the battery up to *do* Part 0. Neither is a
product bug; both were blocking the gate that every later part depends on, so
they were fixed before Part 0 was committed and are recorded here.

## S-1 — the suites hardcoded two mock ports, and another product was on them

`mail-suppression`, `theme-depth`, `giving-flow-brand`, `portal`, `migc` and
sixteen more suites each stand up their own Resend mail sink on a literal
`:5602` and Stripe mock on a literal `:5603`. This machine also runs the
Kingdom Builders dev stack, whose `scripts/dev-mocks.js` binds **exactly those
two ports**. The result was **21 of 104 suites red**, with failures that read as
product bugs (`invalid_link`, wrong receipt brand colors, 6 assertion failures in
`giving-flow-brand`) rather than as a port clash. Only `mail-suppression` said
the true thing: `could not bind :5602 — another sink running?`

**Fixed.** `tests/helpers.js` now owns both ports as the single seam:

```js
const SINK_PORT        = Number(process.env.SINK_PORT || 5602);
const STRIPE_MOCK_PORT = Number(process.env.STRIPE_MOCK_PORT || 5603);
```

Every suite reads them; no literal remains outside that definition. Defaults are
the historical values, so `tests/run-all.sh`, `tests/README.md` and `ci.yml` are
behaviorally unchanged and CI needs no edit. Moving them requires moving *both*
halves together — the suite's `SINK_PORT`/`STRIPE_MOCK_PORT` **and** the server's
`RESEND_BASE_URL`/`STRIPE_API_BASE` — which is now documented in run-all.sh's
header. BUILD-72 ran the whole battery on `SINK_PORT=5622 STRIPE_MOCK_PORT=5623`
with the Kingdom Builders stack left running and untouched.

## S-2 — a suite asserted against another product's `/health`

`tests/notify-delivery.test.js:149` read
`fetch("http://localhost:5601/health")` — a **literal port**, ignoring `BASE`.
With Steward on `:5606` and Kingdom Builders on `:5601`, that assertion was
reading **Kingdom Builders' health endpoint** and failing on its
`failedPending: 0`.

This is the precise hazard `product.js` was written to prevent — *"a server
answering on localhost may belong to a DIFFERENT product entirely (a near-miss
that has happened), and a host/port check cannot tell them apart"* — reappearing
in the test suite, where the identity guard does not reach. Two more literal-port
requests in `tests/presentation-wiring.test.js` (`/auth/register-org`,
`/auth/login`) had the same exposure.

**Fixed.** All three now go through `BASE`. `notify-delivery` 27/0.

**Worth a future guard:** nothing stops the next literal from being written. A
source-scan assertion ("no `localhost:<port>` literal in `tests/` outside
`helpers.js`") would make this class unshippable, in the style of the existing
`script-guards` / `asset-retention` total-classification suites. Noted for
BUILD-73; not built here, to keep this build's scope where the brief put it.

---

# OUT OF SCOPE — CONFIRMED AND CARRIED TO BUILD-73

Per the brief, noted and stopped:

- **User removal from an organization** — 0.5 above. Confirmed absent; the
  session-revocation machinery it needs already exists and is correct; the
  dangling-`assigned_to` cleanup is the real work.
- **The platform billing webhook, still mock-era.** Nothing charged until
  2027-01-01. Not GTM-blocking.
- **Idempotency on `POST /donors/:id/interactions` and `POST /donors`** — 0.2b.
  Real, not money, different seam.
- `DISABLE_RATE_LIMIT` → `TEST_MODE` rename, row-level security, security
  headers, super-admin audit log.
