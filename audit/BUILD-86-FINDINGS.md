# BUILD-86 — PART 0 CENSUS, and four adjustments to the brief

**2026-09-16.** Home and her words. Part A (the Home/Dashboard split) is built
from this census; **Part B (vocabulary) does not start until after the Heart of
Africa meeting**, per the brief, and its examples get rewritten with Henderson's
actual words first.

---

## THE FOUR ADJUSTMENTS, AND WHY

The brief's central claim is *"nothing here adds a feature. It moves things and
renames things."* Three of these exist to keep that true; the fourth closes a
hole the brief nearly left open.

### A1 · "since her last login" → a fixed 7-day window

The Home sentence was specified to read recurring failures **and lapses since
her last login**. **Steward has no concept of last login on this path.**
`users` carries no `last_seen_at`, no session-start stamp, nothing a read could
use — so "since her last login" is new state, which makes Part A a schema
change and breaks the premise.

It is also the *wrong* state to want. A fundraiser who was off for two weeks
would get a sentence naming fourteen days of failures on her first morning
back, which is the opposite of the calm screen this build is for.

**Adjusted: "in the last 7 days."** Fully supported today (`payment_recovery_events`
and `recurring_subscriptions` both carry timestamps), stable morning to morning,
and it says something a person can hold.

### A2 · Which numbers are allowed to stay on Home

*"Home renders no numeric-only element"* would fail against the Thread card
BUILD-85 just shipped, which renders three numeric lines. Rather than author a
test around a judgment I have not been given, the judgment is made here and the
test is written to it:

| Line | Verdict | Why |
|---|---|---|
| `15 open · 9 overdue · oldest 0 days` | **STAYS** | it counts the named rows directly beneath it — a label for a list, not a metric |
| `and 3 more open. The 12 above are the ones that cost the most to leave.` | **STAYS** | same: it describes the list it sits under, and hiding the remainder was the BUILD-85 defect |
| `Last 30 days · 12 closed · 67% led straight to the next step` | **MOVES to Dashboard** | a performance measure of her, over a period. Board-shaped, and the only one of the three she cannot act on |

**The rule the test encodes** is therefore not "no numbers" but the brief's real
sentence, which is better: *no row on Home is a number without a name attached.*
A count that labels the named rows under it is not that; a rate over 30 days is.

### A3 · Part B is scoped to the enumerated surfaces, not to 0.3's count

0.3 below counts **2,513** occurrences of "donor" in `client/src`. Routing all
of them through `t()` is not an evening and not a week — it is a sweep across
every component in the product, and the class of change that produces a hundred
small breakages nobody notices until a customer does.

Only **~134** of those occurrences are rendered JSX text. And the brief's own
Part B already lists the surfaces that matter: Home's sentence, Thread step
labels, Drift reasons, recurring recovery copy, nudge email subjects, Dashboard
axis labels.

**Adjusted: that list IS the scope.** 0.3 is a census that confirms the list is
complete, not an inventory that implies all 2,513 get migrated. Any surface the
census finds that the list missed gets added to the list — which is what the
brief asked for anyway, read the right way round.

### A4 · Vocabulary never touches what a donor receives

The brief says *"never rename a database column or an API field. Vocabulary is
presentation only."* Good, and it needs its sibling:

**Vocabulary must not reach a receipt, a year-end statement, or the donor
portal.** A §170 acknowledgment is a legal document; an org calling its people
"sponsors" must not change the words on one. The same holds for the year-end
statement and for anything rendered on the org's public portal, where the
audience is the donor rather than the staff member who chose the word.

Part B's `t()` is a **staff-surface** helper. The receipt renderer, the
statement renderer and `client/src/pages/Portal.jsx` are out of its reach, and
that will be asserted rather than remembered.

---

## 0.1 · What Home renders today, top to bottom

Home is already section-based (BUILD-34): `HOME_SECTIONS` in
`client/src/lib/homeLayout.js:27` is the registry, and `Dashboard.jsx:1953`
maps each id to its JSX. **That is what makes Part A a move rather than a
rebuild** — the split is a property on the registry, not surgery on a page.

| # | Section id | Renders | `Dashboard.jsx` | Verdict |
|---|---|---|---|---|
| 1 | `hero` | fundraising goal, % of goal, pace, this-week raised, re-engaged | 923 | **BOARD** — a number, no name |
| 2 | `setup` | the six-item activation checklist | (SetupChecklist) | **HERS** — actions, and it disappears when done |
| 3 | `thread` | the ranked queue + Needs-Your-Attention folded in | 1607 | **HERS** — every row is a name, a reason and one action |
| 4 | `monthly` | imported-sustainer counts + "N stopped" | 1746 | **BOARD** — counts with no name attached (the *failures* she can act on live in the recurring card, not here) |
| 5 | `drift` | the drift list: donors past their own pattern | 1772 | **HERS** — names with reasons |
| 6 | `retentionPipeline` | donor retention rate, pipeline funnel, next grant deadline, recurring health | 1777 | **SPLIT** — retention + funnel are BOARD; the recurring *failures* are HERS and move to Home as their own row group |
| 7 | `myPortfolio` | six FY stats (portfolio, visits, moves, gifts, pipeline, lapsed) | 1127 | **BOARD** — a stat row |
| 8 | `impact` | "Steward has recovered $X…" | 1854 | **BOARD** — a figure about the product |

**Consequence worth stating:** Home keeps `setup`, `thread`, `drift` and gains a
recurring-failures row group; **everything else moves.** That is five of eight
sections leaving, which is the point — the brief asked for fewer things, each
already decided.

## 0.2 · The nav today

`client/src/App.jsx:30` `TABS` — dashboard ("Home"), donors, pipeline,
fundraising, grants, communications, portal *(hidden from the CRM)*, tasks,
workflows, reports, finance, settings. `NAV_GROUPS` (`:73`) groups the sidebar:
**People** (donors · pipeline · tasks) · **Fundraising** (fundraising · grants ·
communications · portal · workflows) · **Insight** (reports · finance), with
Home ungrouped at the top and Settings pinned at the bottom.
`BOTTOM_TABS`/`MORE_TABS` (`:48`, `:54`) are the mobile shell.
`CRM_HIDDEN_TABS` hides `portal`; `TEAM_GATED` holds `pipeline`.

**Part A adds one id (`board`) and touches nothing else.** The existing
`dashboard` id keeps its route and its label ("Home") so every deep link,
`navigateTo("dashboard")` call and the morning email's links keep working
unchanged — renaming that id would have been a rename across ~40 call sites for
no user-visible gain.

## 0.3 · The vocabulary surface (Part B's real size)

Occurrences in `client/src`, case-insensitive:

| Term | Occurrences | Rendered as UI text |
|---|---|---|
| `donor` | **2,513** | ~134 |
| `fund` | 792 | — |
| `campaign` | 516 | — |
| `lapsed` | 173 | — |
| `designation` | 82 | — |
| `sustainer` | 39 | — |
| `monthly donor` | 9 | — |
| `recurring donor` | 3 | — |
| `major donor` | 2 | — |

The gap between 2,513 and ~134 is the whole finding: the overwhelming majority
are identifiers — `donorId`, `donors.map`, `/donors/:id`, `donor_id` — which
**must not** change, because the brief is right that vocabulary is presentation
only. See **A3**: Part B is scoped to the enumerated surfaces.

Encouraging: `sustainer` (39) and `recurring donor` (3) are already small, and
BUILD-57 moved most sustainer-facing copy to "monthly donor" — so Sparrow's
"sponsor" is a smaller change than it looks.

## 0.4 · What the product already learns about her words

**There is already a store, and Part B reads from it rather than inventing a
second one.** Three places, all populated by the import:

- **`fin_funds.name`** — fund/program names, created from her file at
  `server.js:1877` and `:12921`. This is the answer to Part B's question 3, and
  it is already hers.
- **`custom_field_defs`** (BUILD-78) — every column she kept that Steward has no
  home for, with **her own label**, her type, and her option values.
  `server.js:16731` is stated as "the ONLY authority on shape".
- **`portal_settings.display_name`** — the donor-facing name of the org, already
  distinct from the staff-side name (BUILD-58 W-2's white-label rule).

What is **not** stored anywhere: what she calls the *people* (Q1/Q2) and her
season (Q5). Those are genuinely new and are the only keys `vocabulary_json`
needs to add beyond pointing at the above.

`orgs` already carries org-chosen words in `legal_name`, `receipt_custom_message`
and `timezone` — so a `vocabulary_json` column on `orgs` follows an established
pattern rather than opening a new one.

## 0.5 · BUILD-85 is merged, and Home already caps and ranks

`d5c8c64`, live. `composeThreads` caps at `QUEUE_CAP` (12), ranks through
`shared/threadRank.js`, bands by due date, reports the remainder, and scopes to
the owner. The Home card renders band headers and a reason per row.
`tests/build85.test.js` is 70 assertions in `run-all`.

**Part A depends on this and it is there.** The Home queue needs no further work
— it moves as-is.

---

## What Part A actually costs

One property on the section registry, one assembled sentence, one new tab id,
and moving five sections. **No new component types, no new metrics, no schema.**
The recurring-failures row group is the only genuinely new JSX, and it renders
from `GET /recurring/health`, which already returns everything it needs.
