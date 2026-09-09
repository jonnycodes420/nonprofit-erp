# BUILD-83 findings — close the import, then make Home tell the truth

## Part 0 — the reproduction (Sept 7 run, replayed locally before any fix)

Fresh org, v3, Jonathan's exact answers (legend on hidden, legend on yellow,
flag-the-40 on comments, Import-as-normal on the bogus blue prompt). Screens
+ DB truth in `docs/build83/repro/`.

**The clobber, confirmed and localized.** The signals screen shows TWO
"highlighted rows" prompts: the yellow 100 on Donors, and a second one for the
gift sheet — its 5 shaded rows are the four year-subtotals and the GRAND TOTAL
(fill #DDEBF7), i.e. chrome that should never have prompted at all. Both
prompts share ONE state key (`filled_rows`), so answering the blue one
Import-as-normal silently overwrote the yellow per-legend choice. The
pre-write summary already showed the damage — "700 rows carry an exclusion …
0 highlighted" — and the DB after commit reads `do_not_contact = 0`. 100
people Cheryl marked do-not-contact were on every ask surface. Two defects:
chrome rows counted in the fill pass (1.1) and shared prompt state (1.3).

**DB truth after commit** (org_41aa58b3): 25,034 donors · 88,967 gifts ·
$50,979,808.17 · 693 exclusion records (deceased 348 / dnc 0 / dns 296 /
dnm 72; 700 on the summary — 7 flagged rows folded as duplicates) ·
600 sustainers (100 card-failed, 60 stale) · 60 pledges ·
**3,107 ledger rows, $1,010,106.39 of FY income posted by the import** (the
Part 6 defect, verbatim) · 0 goals rows on this org (the prod auto-goal came
from a path this replay skipped — hunted in Part 3.2).

**Timing** (missing from the Sept 7 record): click-to-summary **13.4s**,
import write 125.9s on a cold fresh-boot DB (the Sept 6 run measured 15.2s on
a warm one; the delta is first-boot index builds, not a regression — re-timed
after the build in the verification walk).

**The contradiction pairs on one screen** (the Part 3.4 enumeration, from the
Sept 7 screenshots + this replay):
1. PIPELINE tile "0 prospects · $0 lifetime" beside a funnel with thousands
   staged (Cultivate 3,143 / Solicit 926 / Steward 2,719 on Sept 7).
2. PORTFOLIO "0 donors · $0 lifetime giving" the screen after importing 25,034.
3. Drift card "$3,808,039.71 · 1,605 donors past their own pattern" vs the
   footer "$38.7M at risk across 19,855 quiet donors" — same word, 10× apart.
4. The goal "Win back $29,955,207 in lapsed giving" vs the funnel "Lapsed,
   window closed · $30M" — the same cohort as both a target and a write-off.
5. Recurring: "Nothing needs you" one line above "160 whose giving stopped",
   and "0 giving" for a file whose Recurring sheet shows 440 giving.
6. The footer stapling "$38.7M at risk" to "No platform fee, no donor tip."

---

## Parts 1–2 — the import, closed

**The clobber (Part 1).** Two defects, both fixed at the root. (a) Chrome rows
were in the fill pass: the gift sheet's four year-subtotals and its GRAND TOTAL
carry a header-band fill (#DDEBF7), which raised a second "highlighted rows"
prompt quoting the YELLOW legend under a blue fill. Every "what the sheet knows"
group is now computed over DATA ROWS ONLY (`buildWorkbookSignals` takes the
analyzed sheet's `rowLines`), and on v3 the screen shows exactly four items on
Donors — 40 hidden, 100 yellow, 40 comments, one hidden column — and nothing for
#DDEBF7 or #BDD7EE. (b) Prompt state was keyed by KIND, so the two fill prompts
shared one answer and the blue one's "Import as normal" overwrote the yellow
one's "per the legend". State is now keyed `(sheet, kind, colour)`; a synthetic
legend-less fill is pinned to prompt on its own with no legend text, defaulting
to import, recording the shade on the row either way. "Import as normal" on the
hidden-rows prompt now reads "(treated as live donors)".

**The two refusals (Part 2).** A duplicate now needs gift id **and** donor
**and** amount. The 721 v3 rows whose legacy Refs collided are different gifts:
both import, both flagged *"shares gift id RE-123456 with row N"*, and the
colliding row drops the source id rather than lie about idempotency (the pair
goes on the review queue). Constant formulas are numbers — `=250*1` is $250 —
so the 843 zero-cached formulas import flagged "computed from formula", while
anything reaching outside itself (`SUM(D2:D9)`, `A1*2`) still refuses with its
text. Duplicate-gift refusals: 721 → **0**. Formula refusals: 843 → **0**.

**Cash.** Imported net cash **$51,754,243.82** — $1,385.25 inside the corrected
key's $51,755,629.07 (tolerance $2,500), and between the key's two arithmetics.
The only refusal reason left on v3 is `no_donor_match` (491 orphan rows,
$252,808.15). The reconciliation now reads in four terms with the residual
named: *the file says X; imported Y; refused Z (n rows); routed W (n rows);
unexplained U* — and U is non-zero on both v3 sheets and therefore shown, with
import confidence capped. It is negative because the file's totals count
Cowork's 896 trailing-minus rows as positive while an honest reader routes them
as the negatives the cells say they are. The file's own total is never called
"stale" — it is the source system's figure.

**Shown is applied (2.1).** `/donors/import-combined` reads back from the
database after commit, over the ids that request inserted, and returns
`written: {donors, gifts, cash, excluded, deceased, do_not_contact,
do_not_solicit, do_not_mail, sustainers}`. The completion screen puts promise
and receipt side by side and goes red on any mismatch. With Part 1 fixed, v3
lands **800** exclusions on the summary and 800 in the database — including the
100 yellow rows that were silently lost on Sept 7.

## Part 6 — Finance

Import posts NOTHING to the ledger, on both import paths. Gift history is what
the org already raised, not money moving through Steward; ledger entries come
from the org or from live gifts. After v3 every account balance is $0 and the
existing unledgered-giving explainer (BUILD-26 B1) carries the story, which
makes the "all-time" label honest by construction. Three suites encoded the old
contract and were updated with their reasoning, not loosened: `consistency-e2e`
(the cross-surface invariant SPLIT — gift-history surfaces carry every gift,
Cash on Hand carries live money, and the gap must be flagged, never silent),
`finance-gift-stamp`, and the once-and-only-once rule still governs every live
path. The nav decision is Jonathan's: `BLOCKED-build83.md`.

---

## Parts 3–5 — Home, Drift, Recurring

**Home (Part 3).** The section list is now Thread → monthly donors → Drift →
retention+pipeline, with the greeting and (during onboarding) the checklist
above them. Retired: the auto-set goal, the four zero-tiles, "Today's Suggested
Outreach", and the footer that stapled a risk figure to "No platform fee, no
donor tip." The saved-layout merge drops the retired ids and appends the new
ones visible, so an existing user's Home follows without a migration.

**No goal until she sets one (3.2).** The second code path was onboarding step
3: it pre-filled the AMOUNT by summing the lifetime giving of everyone the
import had just labelled lapsed, which is where "Win back $29,955,207 · 0% · 89
days left" came from. The step still suggests a shape and leaves the number
empty. After v3 on a fresh org there are zero rows in `fundraising_goals` and
Home reads "Set a goal for this year".

**At risk, redefined (3.3).** The quiet-donor cohort is deleted from `/impact`
and from every surface. At risk is Drift's, and Drift's dollars are now the sum
of each donor's USUAL GIFT — the amount their own sentence names — not their
trailing-24-month total and never their lifetime. Baker Community Foundation
shows $2,500, not the one $25,000 it gave once, and the list sorts by the figure
it displays. The funnel's "Lapsed, window closed" keeps its count and loses its
dollars.

**Stages are suggestions (3.5).** `donors.suggested_stage` carries everything
inferred; `stage` is NULL until a human places someone. After v3: 25,034
suggested, **0 placed**. Board and portfolio membership read placed-or-suggested
so assignment never loses a donor (BUILD-30's single definition holds), and each
card says which it is. A stage the FILE stated is still a decision and still
lands in `stage`.

**Drift rows (Part 4).** The figure is labelled "at risk"; "Done" is now "Log
the call" (it opens the Thread's log step for that donor); dismissing is
secondary, reads "Not drifting", and REQUIRES a reason before it will save.

**Recurring (Part 5).** One definition of the file's own sustainer facts
(`sustainerFileFacts`) feeds Home, the tab headline, the exception tiles and the
checklist — before it, Home said "100 stopped" while the tab said "160" and "0
giving" on the same file. On v3: **600 from the file · 440 giving · 160 stopped
· none connected**, matching the key (100 failed cards + 60 stale-Active). A
"Stopped giving (from your file)" tile exists, "Nothing needs you" cannot appear
while it is non-zero, Home carries the monthly-donors card, and the checklist has
its Move-your-monthly-donors step.

## What the walk found that the suites could not

Two real defects surfaced only in the browser, both caught by Part 2.1's
read-back:

1. **The promise and the receipt were in different units.** The summary said
   "800 rows carry an exclusion"; the database held 792 records, because 8 of
   those rows fold into a surviving duplicate. Both true, but a promise the
   database cannot match is a promise the product should not make. The summary
   now leads with the 792 PEOPLE who will carry one and says the 800 rows they
   came from.
2. **709 gifts were being collapsed on the way in.** The collision fix rewrote
   each colliding row to drop its source id — and a `if (kept.length !==
   b.items.length)` guard threw the rewrite away whenever no row had been
   refused, so 709 gifts reached the server still sharing an external id and its
   idempotency unique swallowed them. The completion screen said it out loud:
   *"shown 90,523 · written 89,814."* Fixed, and pinned in the golden: no two
   gifts in a payload may share a source id.

## Timing

Click-to-summary **43.8s**; the write **16.1s**; the whole import inside a
minute for 25,300 donors and 92,227 gift rows. (The Sept-7 run was not timed;
BUILD-82's 6.2s parse became 43.8s because the pre-write pass now reads every
fill, comment and hidden row on every data sheet and computes the fold, the
four-term reconciliation and the flags before it will show a number.)

---

# FIX (Sept 8) — merges not logged · receipt missing the money · the write

## 1. 266 folds, no undo record — found, fixed, pinned

`POST /donors/import-semantics` stores a fold as `{surviving, folded: [...]}`
where **folded is an ARRAY** of identities (BUILD-80 Part 6.2 — each carries the
label, the reason, the source id and the gift ids the undo moves back). BUILD-82's
workbook wrote the review list as `{surviving, folded: "<a name>", reason}` — a
STRING — and the persist loop's `Array.isArray(m.folded)` guard skipped every one
with a bare `continue`. So 25,300 rows became 25,034 donors, 266 merges were
performed, and the screen said "0 merges logged for undo". The merge itself was
correct; the *reversibility* was gone, silently.

Three changes: `resolveDonorSheetDuplicates` now emits the persist shape;
`buildWorkbookSubmission` attaches each folded identity's gift ids (so the undo
takes exactly their gifts with them); and the route **reports what it cannot
store** — `counts.mergesUnstorable` plus a sample of the shape, on the response
and in the server log. A shape this route does not understand can never again be
invisible.

Pinned in `tests/import-workbook-server.test.js` §7–8: two donors fold, the fold
is stored and listed with its gift ids, `POST /import-merges/:id/undo` splits the
identity back out, **that identity's gift goes with them and only theirs**, the
surviving donor keeps their own, a second undo is refused (409), and a
bare-string merge is counted as unstorable rather than dropped.

## 2. The read-back was hand-written, so it could not catch this

The promise is now a DECLARED FIELD LIST — `IMPORT_PROMISE_FIELDS` in
`shared/importShape.js` — and both screens derive from it: the pre-write summary
shows those figures, the completion screen reads the same keys back from the
database. A figure added to the summary with no way to read it back renders as
**"shown N · not read back"** in red rather than as silence. Nine fields:
donors · gifts · **imported cash** · people excluded · monthly donors ·
**merges** · **pledges** · **pledge payments** · the gift-row identity. Refusals
are compared **by reason** (`refusalsByReason`), and because a refusal is an
absence with no row to count, the receipt checks the identity instead: written +
refused + routed === gift rows in the file (92,227 on v3).

**Extending it immediately caught two more:** pledge payments read "shown 216 ·
written 210" — the promise was counting rows before the join, and six were
orphans that never landed; and "rows set aside · not read back" was a figure the
database structurally cannot hold. Both fixed: the promise counts what lands, and
the refusal check became the identity above.

## 3. The receipt carries the money and the set-aside list

The completion screen shows imported cash read back from the database
(**$51,754,243.82 ✓** on v3), the merge count, pledges and payments separately,
and the full set-aside-by-reason list with its downloads — the same reason
vocabulary as the pre-write screen, from one table. A receipt without the amount
is not a receipt.

## 4. The write — profiled, and the cause named

**Batch size is a round-trip budget.** Every gift batch costs four trips to the
database (SAVEPOINT · INSERT gifts RETURNING · INSERT interactions · RELEASE),
so 90,523 gifts at `GIFT_BATCH = 200` was 453 batches ≈ **1,914 round trips**.
On a local socket (~0.1ms) that is invisible — the write measured 16s here.
Against a hosted database it is the whole cost, which is why the same file
measured **221.4s on production**.

Measured, not assumed: a TCP proxy in front of the scratch Postgres adding 2ms
each way (4ms round trip), same file, same machine —

| | round trips | import-combined |
|---|---|---|
| before (500 / 200) | ~1,914 | **35.3s** |
| after (1,000 / 2,000) | **~236** | **27.9s** |

7.4s saved at 4ms RTT ≈ 1,678 fewer trips × 4ms, which matches the model and
confirms the diagnosis. Prod's round trip is an order of magnitude larger, so
this is where the minutes were. Batch sizes are bounded by Postgres's 65,535
bound-parameter cap (donors bind 46 → 46,000; gifts 13 → 26,000) and are now
named constants with that reasoning, overridable by env for measurement. The
merge write, which my own fix had made ~800 trips (three per fold), is now
set-based: one existence read, one survivor read, one batched INSERT.

Every import logs its budget: `[combined-import] … 26 batches … 46 batches —
~236 write round trips`.

**Numbers recorded either way:** time to summary **44.3s** (target <60s, met);
time in the write **25.1s** locally. The production figure needs a production
run — the honest claim here is the trip count, which is machine-independent.

## 5. Two measurements, two names

The label said "Click to summary: 221.4s for the write", which is two different
things wearing one name. The receipt now reads: **"Time to summary: 44.3s
(reading the file and reconciling it). Time in the write: 25.1s."**

---

# FIX (Sept 9) — one column-target dropdown, one guesser

## Reproduced

`tests/fixtures/mapper/prospect-research-30col.csv` (seed 20260909) — 30 headers
from a prospect-research export, none of them Steward's vocabulary. On the
"one row per donor (totals)" shape the column dropdown was a flat list of 17
internal keys (`lastAmount`, `doNotContact`) with no custom-field groups and no
way to make a home for the 26 columns it didn't recognise. The same dropdown in
the workbook mapper had all three groups.

## 1. Three dropdowns became one

Census: the CSV donor mapper (flat, `Donors.jsx`), the BUILD-78 transaction
mapper's card (proposal controls plus a rival "…or map to a standard field"
select), and the BUILD-82 workbook mapper (the grouped one). The grouped one is
now `client/src/components/ColumnTargetSelect.jsx` and **all three render it**;
the rival select is deleted and the workbook's private copy of the inline
creator is gone. Each shape supplies its own standard vocabulary as a prop —
what a CSV donor import writes is unchanged — but the three groups, the inline
creation and the "don't import this column" option are one implementation.

`tests/mapper-one-dropdown.test.js` (32, in run-all) renders the mapper for
**each entry shape in a real browser** — single CSV donor totals, single CSV
report export, workbook donors sheet, workbook gift sheet — and asserts all four
carry a Standard fields group, a "＋ New custom field" option and a "Don't
import this column" option. It also drives the creation: the field is made from
the mapper, prefilled from the header, and appears immediately as an existing
custom field on every other column.

**It caught a bug on its first run.** `wealth_indicator` (three distinct values)
proposes as a `select`, and the create call sent `options: []` — which the
custom-field seam correctly refuses with a 400. The proposal's options now ride
with its type, switching type keeps or drops them honestly, and a choice field
with no options can't be submitted at all.

## 2. Two columns cannot become one field

The dropdown disables a standard target another column already holds, and the
Import button refuses by name — *"Two columns are mapped to full name —
'contact_name' and 'contact_confidence'. Pick one, or send the other somewhere
else."* No standard donor field legitimately takes two sources (first and last
name are two different fields), so the exception list is empty and documented;
a shape that grows one adds it there with its reason.

## 3. The guess that caused it

The collision came from header matching, not value matching: `guessField` used
`header.includes(label)`, so **"contact_confidence" contains "contact" → name**.
The same rule also mapped **"capacity_estimate" → city** (it contains the
letters of "city") and **"region_code" → state**. This is the defect BUILD-82
fixed for the workbook ("Unnamed: 31" became the name column and threw away
23,867 donors); the CSV path still had it.

Matching is now whole-header: a label matches the entire normalised header, a
trailing word-run ("contact name" is a name), or a leading run **only when what
follows is not a qualifier** — a word that turns a subject into a measurement
about the subject (`code`, `confidence`, `score`, `estimate`, `band`, `tier`, …).
"Email Address" is still an email; "region code" is not a region. Twenty cases
are pinned.

On the fixture the guesser now maps exactly two columns — `contact_name` → name,
`research_note` → notes — and leaves 28 for a human, each with a dropdown that
can give it a home. Two further rules: `buildAutoMapping` **drops** a guess whose
target another column already took (first header wins), and the contents-based
"Guess from contents" path may only FILL an unclaimed target — it never
overwrites a mapping already made, never duplicates one, and says how many
guesses it left for you to place. A guess nobody can check defaults to skip.
