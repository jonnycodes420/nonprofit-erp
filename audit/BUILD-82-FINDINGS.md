# BUILD-82 findings — the workbook layer

## Part 0 — the reproduction (before any fix)

Fresh org, `steward-messy-25k-v3.xlsx` (7.6 MB, nine sheets, 25,300 donor rows,
92,682 gift-ledger rows), through the real UI at 1440. Screens captured to
`docs/build82/repro/` (01 sheet picker, 02 import-both pre-write, 03 legacy
sheet alone), body text alongside each.

What the screens said, verbatim:

- **Sheet picker**: "This workbook has 8 sheets with data." Sheet1 (empty)
  dropped; Cover (10 rows), Summary (5 rows) and "Old export (do not use)"
  (8,000 rows) offered as ordinary data with Select buttons. "Import both"
  paired Donors with ONE gift sheet; Gifts 2019-2022 (36,050 rows of the same
  people) left for "separately afterward". Counts inflated by non-data rows:
  56,182 shown where the sheet holds 56,177 gifts, 25,302 where it holds
  25,300 people.
- **Import-both pre-write**: "2,282 gifts → 1,433 donors · 1,433 warnings ·
  53,900 gift rows skipped (no amount / no donor)" with "Unmatched gifts become
  new donor records — never dropped" two lines above it, and a button reading
  "Import 1,433 donors + 2,282 gifts →". The Donors sheet has 25,300 people.
- **Legacy sheet alone**: header found on row 2, TOTAL excluded, day-first
  inferred from 14,356 impossible cases — all correct — then "No rows ready —
  map at least one column to name or email. Import 0 donors →". The `ID`
  column was offered as a NUMBER CUSTOM FIELD on the donor ("3,000 of 3,000
  values parse as a number") because the standard target list has no Donor ID.

## The 53,900, split by cause (measured in Node with the exact UI pipeline,
## before any fix — `linkGiftsToDonors` replicated to the digit: 2,282 / 1,433 / 53,900)

**53,900 = 46,086 "no donor" + 7,814 "no amount".** Two separate defects.

### The 46,086 "no donor" — the join defect
1. **35,747** of them match a donor row that the auto-mapper THREW AWAY.
   The Donors sheet's stray-cell orphan column is headered `Unnamed: 31`;
   `guessField` matches labels by SUBSTRING, and "unnamed: 31" contains
   "name" → the near-empty junk column became the name column, which set
   `hasSingleName=true` and dropped the real First/Last mapping. Then `Email 2`
   (sparse, 1,433 values) and `Email` both map to `email`, and the later header
   overwrites the earlier in the row builder — so donor emails came from
   Email 2. Result: only 1,433 of 25,300 donor rows survived the
   name-or-email gate, every one warned "no name".
2. **~9,839** have an ID form the exact-string compare refuses: the Donors
   sheet holds `20474` (number) and `008449` (text, leading zeros); the gift
   sheet holds `006997`, `8763.0`, ` 4212 `. `linkGiftsToDonors` compares
   `String(v).toLowerCase().trim()` — no `.0` strip, no leading-zero
   normalisation — so `4212.0` ≠ `004212` ≠ `4212`.
3. **~500** are true orphans (IDs matching nothing on any sheet) — the only
   rows that SHOULD refuse, and the current screen would instead have said
   "unmatched gifts become new donor records" had they carried a name.
   (2+3 measured together as 10,339 = gifts that stay unmatched even with all
   25,300 donors present under exact-string compare.)

Because the gift sheet has NO name and NO email column, every unmatched gift
fell through "unmatched → minimal donor" (which requires name-or-email on the
gift row) into the skip pile. The promise printed two lines above the count
("never dropped") was false for 46,086 rows.

### The 7,814 "no amount" — the typed-cell defect
Typed xlsx cells are stringified (`String(v)`) before the BUILD-80 money
grammar sees them, so:
- **6,779 unreadable amounts** — dominated by float-noise doubles
  (`25.0000001`, `1499.9999999`, `100.000003`): real numbers Excel shows as
  $25.00, stringified to 7+ decimals, refused by the closed money grammar
  (which correctly refuses >2 decimals in TEXT). A number CELL with float
  noise is a rounding job, not a refusal. Also in this pile: text negatives
  (`$-500.37`).
- **989 zero amounts**, of which **843 are formulas with cached value 0**
  (`=500.0*1` cached 0) — currently silently counted as zero rows instead of
  refused with the formula text shown.
- **45 negative** amounts, **2 blank**.
- **560 percent-format cells** (v=0.25 shown as 25%) are NOT in the skip pile —
  worse: they imported silently as $0.25. The format was thrown away.

### The counts on the picker
- 56,182 vs 56,177: the gift sheet carries 4 subtotal/note rows + 1 chrome row
  the row-counter includes (classifyBodyRow caught only 1).
- 25,302 vs 25,300: the Donors sheet's title row + section band above the real
  header both counted (header correctly found on row 3, but two body-band
  rows survived).

### Not one defect but two, confirmed
The join defect (46,086) and the typed-cell defect (7,814) are independent:
fixing the join without the cell types still refuses 7,814 readable gifts;
fixing cell types without the join still drops 46,086 gifts and 23,867 donors.
