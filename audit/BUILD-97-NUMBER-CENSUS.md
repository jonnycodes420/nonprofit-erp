# BUILD-97 Part 2 — the numeric census

*Every numeric tile, badge, score and percentage in the app: what computes it,
the sentence a director would say to explain it, and whether it survives.*

Run the scanner yourself:

```
node scripts/build97-number-census.js            # counts, per file
node scripts/build97-number-census.js --claims   # the claim-shaped sites
node scripts/build97-number-census.js --sites    # every site, with line numbers
```

`tests/build97-numbers.test.js` asserts the per-file counts **exactly** — not as
a ceiling. Put a number on a screen and the count rises and the suite fails
until this document says what it is. Take one off and it falls and fails the
same way. There is no direction in which a numeric surface can change silently.

---

## The three rules a number has to pass

1. **It is computed from the organisation's own rows.** Nothing looks outside
   the customer's file — no screening, no sector model, no estimate of what
   somebody could afford.
2. **It can be stated in one plain sentence.** If the honest explanation needs a
   paragraph, the number is doing more than one job and should be two numbers or
   none.
3. **That sentence is on the screen** — inline, or on a hover reachable by
   keyboard and readable by a screen reader. A definition in a source comment is
   a definition that does not exist.

A number that fails any of the three comes off. The survivors are in
`shared/numberCensus.js`, which is the one place their sentences are written;
the suite reads the registry and finds each sentence in a real browser.

---

## What was counted

**390 numeric render sites** across the active surfaces, of which **106 are
claim-shaped**.

A **claim** is a figure in display type, under a label, standing alone and
inviting a reading: *Weighted forecast $59,500*. A **cell** is a number in a
table under a column header that says what the column is: *$2,000 · 4 Mar 2026*
in a gift list. The distinction is load-bearing — censusing three hundred table
cells at the same depth as the fifteen tiles that make claims would bury the
things that matter, and a census nobody can read is a census nobody checks.

### Per file

| File | Numeric sites | Claim-shaped |
|---|---|---|
| `Donors.jsx` | 115 | 15 |
| `Dashboard.jsx` | 62 | 24 |
| `Finance.jsx` | 44 | 3 |
| `Reports.jsx` | 41 | 25 |
| `Fundraising.jsx` | 30 | 16 |
| `Communications.jsx` | 21 | 6 |
| `Grants.jsx` | 13 | 5 |
| `AnnualFund.jsx` | 12 | 4 |
| `shared.jsx` | 9 | 0 |
| `RecurringGiving.jsx` | 8 | 3 |
| `Settings.jsx` | 8 | 1 |
| `FunnelChart.jsx` | 4 | 0 |
| `Programs.jsx` | 4 | 0 |
| `PortalWidgets.jsx` | 4 | 0 |
| `PortalBanner.jsx` | 4 | 0 |
| `Pipeline.jsx` | 3 | 3 |
| `DonorMap.jsx` | 3 | 0 |
| `Dashboards.jsx` | 2 | 0 |
| `Workflows.jsx` · `MetricBreakdownPanel.jsx` · `Uploader.jsx` | 1 each | 0 / 1 / 0 |

### Out of scope, each with its reason

| Surface | Why |
|---|---|
| `Events.jsx` · `Volunteers.jsx` · `Board.jsx` | Hidden from the nav since the 2026-07-12 pivot. Their numbers are real and nobody can reach them. |
| `AnnualFund.jsx` · `Programs.jsx` | Not imported by anything. Scanned (so an accidental revival is visible in the count) and not censused. |
| `Landing.jsx` · `Pricing.jsx` | Public marketing. Their own guards — `scripts/landing-prod-verify.js`, `tests/one-date.test.js`. |
| `Donate.jsx` · `Portal.jsx` · `GivingDashboard.jsx` | Donor-facing, white-label, their own palettes and their own guards. |
| `AdminDashboard.jsx` | Super-admin ops tool; a different audience and a different bar. |

---

## The claims, surface by surface

### Home — the Today rail · **3 survive, unchanged**

These already rendered their definitions **inline** before this build. They are
in the registry so they cannot quietly lose them.

| Figure | Computation | Sentence | Verdict |
|---|---|---|---|
| Open follow-ups | `COUNT(threads WHERE closed_at IS NULL)`, the caller's own | "Every donor with a next step planned and not yet done." | **Survives** |
| Due today | the same, filtered to `due_date == org civil today` | "Next steps whose date is today, in your organization's timezone." | **Survives** |
| Cards failed this week | subscriptions failing inside 7 days with no payment since | "A recurring card that declined in the last seven days and has not gone through since." | **Survives** |

### Home — At Risk From Drift · **survives, already explained**

`SUM(usual gift)` over donors past their own cadence, with the sentence already
under it: *"Giving from donors quietly past their own pattern — each is on the
Drifting list below, with the reason, while a call still works."* Drift's
per-donor sentence (*"$2,000 every March since 2019. Nothing for 14 months."*)
is the model this whole part is built against: every number in it is that
donor's own.

### Home — the morning sentence · **survives**

`shared/homeNote.js`. Numbers under ten are spelled; a day count stays a
numeral. Every figure names a person. Nothing to add.

### The donor profile · **3 survive, 1 comes off**

| Figure | Computation | Verdict |
|---|---|---|
| Lifetime | `donors.total_giving` — every gift on the record | **Survives**, sentence added |
| Last Gift | the most recent gift's amount and date | **Survives**, sentence added |
| Contact | days since the most recent `interactions` row | **Survives**, sentence added |
| **Giving strength 77/99** | `donorScore()` — amount, recency, frequency, clamped 5..99 | **REMOVED from this screen** |

**Why the score comes off the profile, having been renamed only two commits
ago.** BUILD-100 changed "Score 77/99" to "Giving strength" and wrote a
definition denying the wealth-screening reading. That was right and it was not
enough. What a rename cannot fix is the **shape**: a number out of 99, in
display type, beside one person's name, is read as a verdict on that person
however carefully it is labelled — and the officer reading it is deciding how
much to ask them for.

It survives as a **column** on the directory and the re-engage list, and that is
not a contradiction: a column is a sort order across a list; a tile beside one
name is a judgement on that record. It now carries its definition there, on the
same keyboard-reachable hover, from the same one string. The score itself is
untouched — `donorScore` still computes it and the lists still show it. Turning
the tile back on is one array.

**Also on this screen and already off:** the hidden wealth-score panel
(`/10`, a capacity tier, a confidence word) renders nothing, gated behind
`WEALTH_SCORE_DEFINITION` being non-null since BUILD-88a. It stays off. It must
never come back under a name that makes a claim about somebody's means from
data that only knows what they have given.

### The donor lists · **survive with their sentence**

Directory (`Lifetime`, `Last Gift`, `Giving strength`) and Re-engage
(`Lifetime Giving`, `Last Gift`, `Days Lapsed`, `Giving strength`). The score
column now carries the hover definition; the rest are the donor's own rows under
a column header that says what the column is.

### Pipeline · **3 survive, and one nearly did not**

| Figure | Computation | Verdict |
|---|---|---|
| Open asks | `SUM(opportunities.target_amount WHERE status='open')` | **Survives**, sentence added |
| **Weighted forecast** | `SUM(ask × STAGE_WEIGHT[stage])` | **Survives, conditionally** |
| Closed this FY | won asks since the fiscal-year start, at the amount received | **Survives**, sentence added |

**Weighted forecast** is the one this part exists for. Its entire explanation
was the two words **"by stage"**. The figure multiplies every open ask by a
fixed probability attached to the donor's pipeline stage — `prospect .1 /
qualify .2 / cultivate .4 / solicit .7 / steward .9 / lapsed .05` — six numbers
somebody decided once and nothing in any customer's file measured.

It survives because those percentages **can** be said out loud and **are** in a
constants table (`STAGE_WEIGHT`, server.js), and only while they are said, with
the admission attached: *"Those percentages are a working assumption, not
anything measured from your file."* A director can now repeat the sentence and a
board member can disagree with it, which is the whole point.

### Recurring giving · **3 survive**

| Figure | Computation | Verdict |
|---|---|---|
| Monthly recurring revenue | `SUM` of each live subscription's monthly equivalent | **Survives**, sentence added |
| Change this month (the waterfall) | `recurring_change_log` rows, by kind | **Survives** — every row is labelled with what it is |
| Sustainer retention · 12 months | alive-at-the-mark ÷ cohort | **Survives** — "X of Y still giving a year in" is already the definition, and the sector benchmark is cited with its source every time it is shown |

### The four dashboards · **all survive, untouched**

`shared/dashboards.js` has refused a metric without a one-sentence definition
since BUILD-86 C.3, `tests/dashboards.test.js` walks the registry, and the same
string reaches the hover and the PDF footnote. Nothing to do. **This part is
that rule applied to the rest of the product.**

### Reports · **data, not claims**

25 claim-shaped sites, almost all of them a table header or the narrative
summary line above a table. A report is the org's own rows with a definition
already pinned, in cents, by `tests/report-truth.test.js` — 85 assertions
against hand-computed values, and the definitions written down in CLAUDE.md
under "Report definitions (LOCKED)". No change.

### Finance · **data, with one explained claim**

Cash on Hand carries its own caption — *"All-time · income − expenses"* — which
is the reconciliation a treasurer can do by hand, and Σ fund balances equals it
exactly. The rest is a ledger. No change.

### Fundraising · **thermometers, already explained**

16 claim-shaped sites, nearly all a thermometer percentage next to
`$X of $Y`, which states its own arithmetic. The exceeded-goal rule (a beaten
goal reads *"Goal met · $X over"*, never a capped 100%) is already pinned by
`tests/goals.test.js`. No change.

### Communications · **counts only**

Send counts, open rates and segment sizes — and per BUILD-94 Part 4, open rates
are **counts only, nothing per person**, which is a data-handling decision
already recorded in `steward-data-handling.md`. No change.

---

## The invented rules

> *"Day 66 is critical — momentum fades after 75 days."*

Nothing computed 75. Nothing defined it. It came out of a model, mid-paragraph,
in the product's own voice, on a screen where every other number is real.

**The Urgency Score is already gone** — BUILD-100 deleted it, and it is worth
recording what it was: `**Urgency Score:** X/10` was a literal line in a prompt
template asking the model to emit a number, printed as though it meant
something. Ask twice, get 7 then 8.

**What this part adds is the guard**, because deleting the strings that exist
does nothing about the next paragraph a model writes.

`shared/thresholds.js` holds **the numbers the product is allowed to say out
loud**, each naming the constant it mirrors: drift's five thresholds, the 365-day
lapse boundary, the four steps of the failed-card cadence, the thread queue's two
caps, the thirty days a contract names, and the two published sector figures
(M+R and FEP) that are cited with their source every time they appear.

`ungroundedClaims(text, { groundedValues })` finds every number in model output
bound to a **time unit** or a **percent** — a *rule*, as opposed to a *fact* —
and reports the ones that are neither in that table nor in the rows the model
was handed.

**Why a time unit or a percent, and not "any number".** Model output carries
numbers all day and most of them are the donor's own: a gift amount, a date, a
year, an ask figure. Forbidding those would forbid the model doing the job it is
there for. What cannot appear is an invented **rule**, because a rule is a claim
about how the world works, and this product's position is that it says nothing
it cannot trace to a row.

| Text | Verdict |
|---|---|
| `momentum fades after 75 days` | **refused** — 75 is nowhere |
| `$2,000 every March since 2019` | allowed — no rule, and the amounts are hers |
| `it has been 66 days` (with 66 in her rows) | allowed — a fact about her |
| `most donors lapse after 18 months` | **refused** — a sector claim from nowhere |
| `she has not given in 365 days` | allowed — `LAPSE_DAYS` |
| `follow up within two weeks` | allowed — 14 days is the thank-you decay cap, and *two weeks* resolves to the same constant |
| `only 24% of donors give again` | **refused** |
| `sector retention is 43%` | allowed — FEP, cited |

---

## Organisations are not people

Per BUILD-80 Part 7, `donors.kind` has three values and organisations were
already off Drift and the re-engage list. Two person surfaces were still open,
and both are the kind of wrong that reaches a donor:

- **Households.** A household is a marriage or a family at one address, combined
  for acknowledgment. *"The Sunrise Foundation Household"* is not a thing, and
  the combined figure would put a foundation's grants on a person's record.
- **Planned giving.** Every planned-gift type — bequest, estate, IRA
  beneficiary, life insurance — is a thing that happens because a **person
  died**. A foundation does not leave a bequest.

Both now refuse, **server-side**, through one helper and one sentence so the two
cannot drift: *"Sunrise Foundation is an organisation, not a person, so it
cannot be part of a household. Organisations have their own list, with
grant-cycle language rather than household and estate language."*

A `kind` of NULL is a legacy row and reads as a person (the BUILD-84 rule), so
nothing that predates the column is refused.

Organisations already have their own list — **Institutional giving**, on the
Drift surface, with grant-cycle language and no Re-engage button.

---

## What this census does NOT claim

- It does not claim that 390 is every number in the product. It is every number
  matched by four named patterns, on the surfaces listed, with the noise rules
  stated in the scanner. The scanner is the definition; the count is reproducible
  and the patterns are readable.
- It does not censuses the report tables, the ledger or the import receipts cell
  by cell. Those are the org's own rows, under headers that name them, with
  their own guards (`report-truth`, `finance-reports-consistency`,
  `import-reconciliation`), and calling them claims would make the census
  unreadable without making the product more honest.
- It does not touch the donor-facing surfaces. Those carry their own palettes,
  their own guards and a different audience, and a pass over them is its own
  piece of work.
