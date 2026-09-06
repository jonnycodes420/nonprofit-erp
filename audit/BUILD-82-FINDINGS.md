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

---

## The build (Parts 1–8) — what shipped and what it measured

### The workbook layer (Parts 1, 3)
- One shared reader (`extractWorkbookFromSheetJS`) reads the file ONCE with
  types, formats, formulas, hidden rows/columns, fills and comments; the same
  code runs in the browser and in the Node suites. 7.6MB / nine sheets parses
  to the roles screen in **6.2s** in the real UI.
- Roles with evidence, all nine right on the fixture: Cover/Summary chrome,
  both gift sheets gifts, Old export a decoy — name evidence plus a sampled
  duplicate probe (99% overlap) and the dollar warning ($4,342,760.71).
- Rows that are not data are found by content and listed by row number: the
  four year-subtotals (SUBTOTAL formulas + "2023 Total" labels), GRAND TOTAL
  ($32,523,933.89 — the would-be largest gift, never imported), the "Exported
  by Cheryl" note row, the stray "x" at row 30000. Counts land EXACTLY:
  56,177 / 36,050 / 25,300.
- Typed cells through the BUILD-80 seams: float noise rounds (6,691 cells),
  percent formats read ×100 and flagged with the spec's sentence (559
  imported + 1 that was a refund), zero-cached formulas refused WITH the
  formula text (843 × `N*1`), date serials → civil dates with no timezone
  conversion, serial 0/60/pre-1900 refused by name, trailing-minus legacy
  amounts route as refunds (948), "$-500.37" parses (the sign inside the
  symbol — a normalizeMoney gap this file found).

### The join (Part 2)
- Donor ID is a standard field on donors and gifts, first in the identity
  order. All four damaged forms match (4212 ≡ 004212 ≡ 4212.0 ≡ " 4212 ").
- Every donors-sheet row becomes a donor. 490 orphan gift rows reach the
  link and are REFUSED by row with their ids and dollars ($252,507.90) —
  never a donor minted from a bare id. (The spec's 500: ten more orphan-id
  rows die earlier at amount refusals — accounted there.)
- Duplicate people fold through a review list: 266 folds, each with its
  reason (same email with a compatible name, same phone with a compatible
  name — never name-only across distinct IDs) and the folded id; gifts
  posted to EITHER id land on the surviving record (pinned in the server
  suite with the damaged forms). The spec's ~300 — see BLOCKED-build82.md.
- Repeated gift ids inside the workbook (721 rows) are the same gift listed
  twice: collapsed BEFORE the pre-write summary, itemised, so the screen and
  the write agree to the row (the server's F-4 unique would have collapsed
  them silently after the promise was made).

### The mapper (Part 4)
- The Part-0 catastrophe is dead by construction: whole-header vocabulary
  (never substring — "Unnamed: 31" maps to nothing), one header per field
  with secondary slots (Email 2, Mobile, Address 2), the full standard list
  on donors (29 fields) and gifts (14), `ID`→Donor ID on a gift sheet,
  Ref→Gift ID, Designation→Fund, Campaign→Appeal.
- One dropdown per column: standard · existing custom · "＋ New custom
  field…" created inline (the field exists the moment it's created, POST
  with the import as source — BUILD-78's explicit-accept law kept).
- Exclusion-shaped columns are locked to the flag family — no custom option
  rendered at all. Hidden columns are never auto-mapped and say so.
- Evidence says its sample: "3,000 of the first 3,000 (of 36,050) values
  parse as a number."

### What the sheet knows (Part 3.5) + the 800
- Hidden rows (40), yellow rows (100), comments (40), hidden column AD all
  surfaced as questions with the cover sheet's legend QUOTED; nothing acted
  on without an answer; "skip" answers are counted and listed by row.
- After confirming: **exactly 800 exclusion rows** — Do Not Solicit Y (200),
  deceased column X-or-death-date (100 — a DATE in a Deceased column is a
  yes, not a FALSE), Status Deceased (60), Do Not Mail (50), notes markers
  (deceased 110 / "remove from appeals" +22 new family member / DNS 78 /
  DNM 23), hidden 40, yellow 100, comments 40. The planted trap — "Do not
  include in vendor mailing" × 331 — excludes nothing (pinned).
- 792 surviving records carry flags (8 duplicates folded); DB-verified.

### The other sheets (Part 5)
- Pledges → 60 commitments, $1,881,000, $0 in cash; resolved server-side by
  external donor id (the sheet has no names).
- Recurring → 100 Failed with 2–6-month-old last charges land on the
  reconnect/recovery surface (`imported_sustainer` + card-failed tag); 60
  "Active" rows with stale charges get the stale flag and the gift pattern's
  verdict stands. DB-verified: 600 sustainers / 100 / 60.

### The summary + scale (Parts 6, 7)
- Two-axis invariant per sheet and workbook: 92,227 rows = 88,967 imported +
  2,047 refused + 1,213 routed ✓, every refusal downloadable with sheet, row
  and reason. TOTAL rows reconciled on screen: GRAND consistent net of
  refusals+routing; legacy's cached SUM called stale by name (19,852,987.83
  vs 13,952,450.79 numeric — 10,818 amounts were textified after the total
  was cached).
- **Timing, real UI, fresh org: parse 6.2s · summary 2.8s · write 15.2s —
  36.5s click-to-done for 25,300 donors + 92,682 gift rows.** One request,
  one transaction (22.3MB payload; json limit raised to 64mb): all or
  nothing. Mid-request kill drill: the org ends at zero-or-all, never a
  slice. The sabotaged-ledger drill still 409s and rolls back in full.
- Net cash imported: **$50,979,808.17** + $252,507.90 orphaned = the sheets'
  readable dollars to the cent. The spec's $53,231,102.55 vs the artifact:
  BLOCKED-build82.md (the $463,902.52 is generator-side truth the file no
  longer carries; every recoverable dollar is itemised on the waterfall,
  pinned at $52,767,200.03… before the gift-id collapse).

### Landing (Part 8)
- Both section heads are one left-aligned column: eyebrow → mark → H2
  (920px) → paragraph (620px), 18px gaps, 48px to the grid; 14/36 at 390.
  +5 guards in landing-prod-verify.js (34 total, gate grew).
