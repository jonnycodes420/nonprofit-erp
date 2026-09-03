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
