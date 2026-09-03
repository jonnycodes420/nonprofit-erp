# BUILD-75 FINDINGS

Working record. Every phase reproduces before it fixes; every number here came
off production (`railway run -- node scripts/build75-phase0-audit.js
--i-know-this-is-prod`, sha `54fe682`, database `postgres`, 2026-09-02).

---

## PHASE 0 — MEASURE (read-only, committed before any code change)

### 0.1 Receipt numbering audit

**The defect being measured:** `allocateReceiptNumber` derives the receipt
year prefix from `new Date().getFullYear()` — the process clock, UTC in
production — so from 19:00 EST on Dec 31 every receipt is numbered for the
following tax year.

**Result: the defect has never fired. The gate does not trip.**

- Production holds **12 receipts**, all for orgs in `America/New_York`
  (the timezone inventory is uniform: 12/12).
- **Axis A** (prefix year vs the allocation instant's civil year in the org's
  timezone — the defect itself): **0 mismatches**. No receipt has ever been
  allocated on a UTC year different from its org-local year, because
  production has not yet crossed a Dec 31 evening.
- **Issued with a wrong prefix: 0** — trivially, since Axis A is empty.
  (Definition note: every receipt row renders its PDF in the same INSERT that
  allocates the number, so "allocated" and "rendered to PDF" are the same set
  by construction. The in-a-donor's-hands signal is `sent_at`; staff PDF
  downloads are not tracked, which this audit reports rather than hides.)
- **Axis B** (prefix year vs the gift's civil-date year / statement tax_year):
  6 mismatches, **all expected behavior, not the defect** — backdated demo
  gifts (2022–2025) receipted in 2026 correctly carry a 2026 issue-year
  prefix. A receipt legitimately issued in January for a December gift will
  always differ on this axis.
- **The exposure is real and exercised nightly:** 6 of the 12 receipts were
  allocated during a window where the org-local civil date and the UTC civil
  date disagreed (evenings ET — e.g. allocated 2026-08-13T01:53Z = Aug 12
  local). Half of all receipts to date were allocated in exactly the window
  where, on Dec 31, the prefix goes wrong. The mechanism is live; only the
  year boundary hasn't been reached. Phase A.1 fixes it before it can be.

**0.1(3) — every other identifier carrying a year, sequence, or period:**

| Identifier | Where | Basis today | Stored? | Verdict |
|---|---|---|---|---|
| `receipts.receipt_number` (`YYYY-NNNNN`) | server.js `allocateReceiptNumber` | process-clock year + per-org `orgs.receipt_counter` | yes, + in PDFs/emails | audited above; fix in A.1 |
| Receipt preview number `YYYY-PREVIEW` | server.js:5850 | process-clock year | never stored or sent | cosmetic; route through seam in A.1 for consistency |
| `board_reports.quarter`/`year` + filename `board-report-qN-YYYY.pdf` | server.js:11647–11712 | process-clock quarter/year | yes (6 rows) | **checked in prod: 6/6 stamps agree with org-local generation month.** Same rollover class (fires on Mar/Jun/Sep/Dec 31 evenings ET); fix in A.5 |
| Donor CSV export filename `donors-<date>.csv` | server.js:3559 | UTC date | filename only | evening-ET export is named for tomorrow; cosmetic; A.5 |
| Full-org export filenames `steward-export-<slug>-<date>.json/.zip` | server.js:17740, 17821 | UTC date | filename only | same class; A.5 |
| `digest_sends.period_key` (`day:`/`wk:`/`mo:`) | server.js digest engine | daily = UTC day (**the A.2 defect**); weekly/monthly = per-org bounds (`ORG_TZ_SEAM_OK`) | yes | daily audited in 0.2; weekly/monthly already seam-correct |
| Year-end statement filename `<tax_year>-giving-statement.pdf` | server.js resend path | `receipts.tax_year` | filename only | correct — derived from the stored tax year, not a clock |
| Defaults: budgets year (11351), retention year (21030), portal `nowYear` (18591, 20299), campaign-send footer year (10004) | server.js | process clock | no — query defaults / display | not identifiers; on the Phase A.4/A.5 call-site list |

No invoice numbers and no batch numbers exist anywhere in the schema
(`db.js` grep: the only sequence in the database is `orgs.receipt_counter`).

### 0.2 Digest dedup audit

**Result: no duplicates, no gaps — and the masking hypothesis is confirmed
with an exact observed send time.**

- `digest_sends`: 129 rows — 60 weekly, 21 monthly, 48 `daily_tasks`.
- **(1) Duplicate pairs** (two `daily_tasks` rows for one recipient whose send
  instants fall on the same org-local day): **0**.
- **(2) Gaps** between a recipient's first and last send: **0**. (Caveat
  reported by the audit itself: `tasks` has no `completed_at`, so "a digest
  should have existed on day X" is only approximable retroactively. With
  zero gap days the caveat never had to carry weight.)
- **(3) Observed send times: every `daily_tasks` send fired at 02:00
  America/New_York.** The documented "morning window [6,12) local" is in
  fact 6–12 **UTC**, and production sends the "morning brief" at 2am ET,
  every day, to both orgs that receive one (CREO Arts, Harbor Music School).
- **Why both wrongs currently cancel:** at 02:00 ET (06:00 UTC) the UTC civil
  date and the ET civil date agree, so the UTC-derived dedup key
  `day:YYYY-MM-DD` happens to equal the org-local day for every row on
  record. The key is wrong and the window is wrong, in the same direction,
  and the observed data shows zero damage — exactly the masking the build
  brief predicted. The damage today is the send time itself: 2am is not a
  morning brief.
- Weekly/monthly sends: keys are computed per-org (`wk:`/`mo:` via
  `weekBounds`/`monthBounds`, already `ORG_TZ_SEAM_OK`); observed send
  instants vary (19:00–00:00 local — the first 5-min tick after the period
  closes or a deploy restarts the timer) but no key+recipient ever sent
  twice (the unique index holds).

**Carried into A.2 — the transition-day decision, made against observed
reality:** because every recorded daily send fired at an hour where the UTC
and org-local civil dates agree, the org-local key on transition day is
*string-identical* to the UTC key already reserved (`day:YYYY-MM-DD`), and
the unique index makes the changeover a no-op for every org in production:
**no double send, no skipped day, no migration required.** The general
hazard (an org whose send window spans a UTC-date disagreement could see one
transition-day double) does not apply to any existing row; A.2 will assert
this at deploy time rather than assume it. Policy if it ever did apply:
**skip, never double** — a missed brief costs nothing, a duplicate teaches
recipients to ignore the email.

### The gate

**0.1 found no issued receipt with a wrong prefix, and 0.2 found no
duplicate and no gap. Both audits are clean.** Per the build brief: a clean
measurement is a result. Phase A proceeds in its planned order — nothing
jumps the queue.

---

## PHASE A — FINISH THE DATE SEAM

### A.1 — Receipt and identifier year prefixes (commit `aa2f964`)

`allocateReceiptNumber` now derives its year prefix from the org's civil
year through the seam. **No migration was needed**: Phase 0.1 measured zero
receipts with a wrong Axis-A prefix, so there was nothing to renumber — the
rule "do not silently renumber an issued receipt" never had to be invoked.
Also routed: the preview number, both `issueDate` stamps, `giftDate` /
statement line-item display (new `orgTime.formatCivil` — the
`new Date(str).toLocaleDateString` round-trip is correct only in a UTC
process zone), the board-report quarter/year stamp + period bounds, and the
three export filenames.

### A.2/A.3 — the daily reminder (commit `8d668ba`)

Window and day are computed per org through `orgClock`; `localDateKey` is
deleted. The transition executed exactly as §0.2 predicted: string-identical
keys, no double, no skip, no migration. **User-visible before the fix:** the
"morning brief" arrived at 2:00am ET (every production send; Phase 0.2's
observed data), and the task list inside it was filtered on the UTC day —
masked only because 2am ET and 6am UTC share a civil date.

### A.4 — retention default year (commit `334dfd3`)

Default year resolves through the seam inside the helper; `/annual-fund`'s
own default routes the same way. **Stored-figure check (read-only, prod):**
229 `retention_rate` snapshots, 2026-07-17→2026-09-03, zero taken inside a
Dec-31 local/UTC disagreement window → no stored figure was ever computed
on the wrong basis; nothing recomputed.

### A.5 — the remaining tainted helpers → ZERO

The reachability scan now reports **0 tainted helpers, 0 call sites** (was
10 / 72 when BUILD-74 filed it). Per-site verdicts, with user visibility:

| Helper (callers) | Fix | User-visible? What a customer would have seen |
|---|---|---|
| `dAgo` (58, all inside `POST /org/load-sample-data`) | helper body routed through the seam — one edit cleans all 58 callers | Marginal: sample data loaded in the local evening carried tomorrow's dates ("last gift: tomorrow" on a demo row). Demo-only, no real data |
| `runCampaignSend` (2) | `{{year}}` template token = org's civil year | Yes, narrowly: a campaign sent 7pm–midnight ET on Dec 31 rendered next year's year in any template using `{{year}}` (typically a footer). No production campaign has been sent in that window |
| `digestYmd` (1, `composeWeekInReview`) | caller reads `orgToday`; **helper deleted** (a kept-around process-clock formatter is a tainted helper waiting for a new caller) | Yes: the Week-in-Review "past-due tasks" section classified a task due *today* as past-due from 8pm ET — same class as the BUILD-72 Part 0 capture, in an email |
| `computeMilestoneCandidates` (1) | anniversary math rewritten as pure civil Y/M/D arithmetic vs the org's today | Mild: near month boundaries in the UTC evening, anniversary candidates fired a day early/late. Staff-review queue only — a human saw a slightly mistimed suggestion, no donor ever did |
| `seedData` (db.js, boot) | `seedAgo`/`seedFromNow` are civil `addDays` on the org-zone today; `elenaFirst`/`julianLastGift` civil too | Demo-only (org_creo): evening deploys seeded demo dates one day forward |
| `monthsSince` (0 callers) | was an inline expression inside `computeMilestoneCandidates` the scanner parsed as a helper; gone with that rewrite | n/a |

**Not in scope, noted:** the §5 expression axis still holds ~14 inline
sites (e.g. `snapshotMetricsForOrg`'s UTC `snapshot_date`, the
`startOfMonth` trio at server.js:~16940, portal `nowYear` display defaults)
— pinned by the §5 baseline, each an instant-vs-civil display/bucketing
default rather than a consumed helper value. They decrease the baseline as
they get routed; none mints an identifier or reaches a donor.

### A.6 — the audit's own defect, closed as a class

**The two axes, re-enumerated after all of Phase A, against baseline:**

| Axis | At BUILD-74 filing | After Phase A | Pinned at |
|---|---|---|---|
| §5 — expressions written (unrouted civil-date sites) | 97 | **85** | `DATE_SITE_BASELINE 85`, must not increase |
| §7 — values consumed (tainted helpers / their call sites) | 10 / 72 | **0 / 0** | two separate assertions: the helper SET must be empty (names printed on failure), and call sites must equal 0 |

The numbers are never summed — they measure different axes, and the audit
prints them separately by construction.

**What changed in the guard itself:**

1. **`scanHelpers` taint is now LINE-level, not body-level.** The old escape
   (`ROUTED.test(body)` cleared the whole helper) meant one seam call
   anywhere in a body hid a raw accessor elsewhere in it. Tightening the
   rule immediately surfaced two helpers the old guard could not see:
   `finPeriodBounds` (a false positive — its `now` was a shim over the
   seam value dressed as a Date; the shim is gone, the civil parts are read
   directly) and `computeRetentionRate` (real: `new Date(g.date)
   .getFullYear()` re-read stored civil dates through the process zone —
   byte-identical on the UTC production runtime, but on any non-UTC process
   every New Year's Day gift bucketed into the prior year; now
   `parseCivil(g.date).y`, zone-independent).
2. **The helper SET is pinned, not just a count.** A helper that becomes
   tainted fails the suite even with zero callers and no new §5 expression;
   a tainted helper gaining a caller fails even with the helper count
   unchanged. Two assertions, deliberately never merged.
3. **§8 proves the guard fails where the defect exists** — `scanHelpers`
   now accepts a constructed tree, and the suite runs four of them:
   the §5 axis held flat while a helper becomes tainted (the expression
   MOVED into a body — nothing new written, §5 blind, §7 fires); a tainted
   helper gaining a caller with the helper count unchanged; and the old
   body-level escape's exact hole (a seam call on one line does not clear a
   raw accessor on another).
4. **The standing rule is in CLAUDE.md** (CRITICAL WORKING RULES): a guard
   whose number cannot fall is not measuring coverage — state what would
   make it fail, and prove it fails.

date-seam 70/70 (was 65 — §8 added, §7 reworked), finance-overview 33/33,
report-truth 85/85, home 41/41, fundraising 34/34.
