# steward-messy-25k-v3.xlsx — what is planted in it

Seed `20260906`, anchored to 2026-09-06. Regenerate rather than hand-edit. Generator `gen-messy-v3.py`, machine-readable truth in `key.json` and `donor-truth.json`.

**v1 tested cells. v2 tested the file and the money. v3 tests Excel and scale.** It is a workbook, not a CSV: nine sheets, the data on five of them, donors on one sheet and gifts on two others joined by an ID that is formatted three different ways. 25,000 people and organisations, 92,227 gift rows on the real sheets, and 8,000 more on a sheet the cover page tells you to ignore. Every cell-level and semantic trick from v1 and v2 is still here at lower density. What is new is the things a spreadsheet can do that a CSV cannot: merged title rows, a two-row header, hidden rows and a hidden column, cell comments, yellow fills, real date cells next to text dates next to bare serial numbers, formulas with and without cached values, booleans, a percent-formatted amount, and subtotal rows inside the data.

Every line below is something the file was built to contain. Where Steward disagrees, either the engine is wrong or the case is ambiguous, and which of those it is, is the finding.

---

## THE WORKBOOK

| Sheet | What it is | Trap |
|---|---|---|
| `Cover` | Title, a note from Cheryl, a **legend**: yellow rows = do not contact, hidden rows = deceased, ignore the old export | It is the first sheet and it has no data. The legend is the only place two exclusion states are defined |
| `Donors` | One row per constituent, **header on row 3** under a merged title and a merged group-header row. 25,300 rows, 32 columns, autofilter, frozen panes | 300 people appear twice under a second ID · 40 hidden rows · 100 yellow rows · 40 cell comments · column AD hidden · a stray cell at row 30,000 makes the used range 30,000 rows · Lifetime Giving is stale on a fifth of rows |
| `Gifts 2023-2026` | Current system, header on row 1, 56,177 gift rows, **US month/day** | 4 year-subtotal rows inside the data plus a GRAND TOTAL, all SUBTOTAL formulas with cached values · 288 rows whose ID exists on no sheet · 805 rows with a Soft Credit ID column · 25 `#N/A` cells · 336 gifts posted to the duplicate's ID |
| `Gifts 2019-2022` | Legacy system, **header on row 2** under a note that says the dates are day/month, 36,050 rows, different column names and order | `Date, Amount, ID, Ref, Gift Type, Designation, Campaign, Notes` — same data, none of the same headers |
| `Old export (do not use)` | 8,000 rows that duplicate 2019-2022 gifts under new Gift IDs | Import it and the legacy years double: **$4,329,708.73** of phantom giving (signed sum of the Amount column; $4,342,760.71 if the 10 refund rows are dropped instead of subtracted; $4,317,456.74 cash-only, in-kind excluded) |
| `Pledges` | 60 commitments with a formula Balance column | Payments are on the gift sheets typed Pledge Payment. Pledge + payments double-counts |
| `Recurring` | 600 sustainers with Frequency, Last Charge, Status | 100 say Failed with a last charge 3-6 months ago · 60 say **Active** with a last charge 4 months ago, which is a stale flag · 440 healthy |
| `Summary` | Cross-sheet SUMIF formulas and one `#REF!` | Not data |
| `Sheet1` | Empty | Not data |

---

## THE NUMBERS

| | |
|---|---|
| Unique people and organisations | **25,000** (400 organisations, 300 donor rows with no gifts anywhere) |
| Donor rows on the sheet | 25,300 (300 are second rows for the same person) |
| Gift rows on the two real gift sheets | **92,227** |
| Net cash across both gift sheets | **$52,376,921.72** |
| `Gifts 2023-2026` GRAND TOTAL row | $32,523,933.89 |
| `Gifts 2019-2022` TOTAL row | $19,852,987.83 |
| In-kind rows, not cash | 200 |
| Refund rows, negative | 120 · $-122,861.28 |
| Corporate matching gifts, cash on the corporation, person named in Notes | 150 |
| Pledge commitments, never cash | $1,881,000.00 |
| Orphan gift rows, ID on no sheet | 500 |
| `Old export` Amount column, signed / positives only / cash only | $4,329,708.73 / $4,342,760.71 / $4,317,456.74 |

The two TOTAL rows are the source system's own figures and they are the first thing to reconcile against. They exclude in-kind, they include refunds as negatives, and they are SUBTOTAL formulas whose cached values are correct. If Steward's "In your file" figure includes the subtotal rows themselves as gifts, it will be roughly double.

---

## WHAT EXCEL DOES THAT A CSV CANNOT

- **The first sheet is a cover page.** A reader that takes sheet one is importing a legend.
- **Donors and gifts are on different sheets.** The join is `Constituent ID`, and it is a number on the Donors sheet (so `004212` became `4212`) while the gift sheets carry it as a number, as text with leading zeros, as `4212.0`, and as ` 4212 ` with spaces. Normalise before joining or 288 real orphans become thousands of false ones.
- **Header rows are not row 1.** Row 3 on Donors under two merged rows; row 2 on the legacy sheet under a note.
- **Dates.** On `Gifts 2023-2026`: 32,403 real date cells, 6,756 bare serial numbers in General format (they look like `45123`), 8,014 text `m/d/yyyy`, 2,816 text `March 15, 2024`, 2,280 date cells carrying a time of day, 1,688 two-digit years. On `Gifts 2019-2022`: all day-first, as the note says, 19,790 of them text. **Two sheets, two conventions, in one workbook.**
- **Amounts** on `Gifts 2023-2026`: 34,874 plain numbers · 6,723 numbers with float noise (`1000.0000001`) · 4,447 text `$1,000.00` · 2,204 text with a trailing space · 2,311 text plain · 1,757 numbers whose *format* shows negatives in parentheses · 1,666 without a currency format · 792 formulas with a correct cached value · **560 amounts stored as a fraction with a percent format** (`0.25` shown as `25%`, true value $25) · **843 formulas whose cached value is 0** (rows listed in `key.json`; the true amount is in the formula text, and a reader that trusts cached values imports $0).
- **Hidden rows** on Donors: 40. The legend says they are deceased. Nothing in any cell says so. A reader that skips hidden rows loses the record; a reader that includes them contacts the dead.
- **Yellow fill** on Donors: 100 rows. The legend says do not contact. Nothing in any cell says so.
- **Cell comments** on Donors: 40 names carry a comment like "Deceased 2024". Nothing else on the row says so.
- **Booleans**: Do Not Mail is a real TRUE/FALSE cell on some rows and blank on others.
- **A hidden column** (Internal Score) that should not become a custom field without a human noticing it was hidden.
- **Formula errors**: `#N/A` in 25 Receipt cells, `#REF!` on Summary.
- **Subtotal rows inside the data** with `2023 Total` in the Gift ID column and a SUBTOTAL in the amount column. They are not gifts.
- **The used range lies.** One stray `x` at row 30,000 on Donors. A reader that trusts `max_row` walks 4,700 empty rows.
- **Numeric ZIPs**: Maine and Massachusetts codes stored as numbers, leading zero gone.

---

## EXCLUSIONS ACROSS FIVE HOMES

- DO-NOT-SOLICIT via Do Not Solicit column = Y: **200**
- DO-NOT-SOLICIT via Notes only: **100**
- DO-NOT-CONTACT via YELLOW ROW FILL only (legend on the cover sheet): **100**
- DECEASED via Deceased column (X or a date): **100**
- DECEASED via Status column: **60**
- DECEASED via Notes cell only: **60**
- DO-NOT-MAIL via a boolean TRUE cell: **50**
- CONTRADICTION via n/a: **50**
- DECEASED via a HIDDEN ROW only (the cover sheet legend says hidden = deceased): **40**
- DECEASED via a CELL COMMENT on the name only: **40**

The five homes are: a column (Deceased, Do Not Solicit, Do Not Mail, Status), the Notes cell, a **cell comment**, a **row fill colour**, and a **hidden row**. The last three are defined only by the legend on the cover sheet. Every one of these people is excluded from every ask surface. The contradictions have Status = Active and Do Not Solicit = N with a deceased note; the note wins.

---

## IDENTITY

- 300 people have two rows on Donors under two IDs; 336 of their gifts are posted to the second ID. One person, two IDs, gifts split across both.
- 300 donor rows have no gifts on any sheet. Prospects, not lapsed.
- 500 gift rows carry an ID that matches nothing. Refuse with the row, do not invent a donor.
- Soft credits are a **column** this time, not a row: 1,500 gifts name a second constituent. The gift is one gift; the second person gets a link, not money.

---

## DRIFT AND RECURRING AT SCALE

Planted cadence cases: 400 seasonal drifting, 300 seasonal fine, 600 quarterly drifting at 2x, 300 quarterly on time, 400 declining, 2,000 lapsed five years, 500 erratic (medium at most), 8,000 single-gift, 80 board members, 60 pledgers (30 fulfilled, 6 overpaid, 8 unpaid, 16 active). Names by category are in `donor-truth.json`; the list is too long for prose.

Recurring: 600 sustainers on the Recurring sheet. 100 say Failed and are the recovery list. **60 say Active and have not charged in four months**; the Status column is stale and the pattern is the truth. 440 healthy.

---

## WHAT A GOOD RUN LOOKS LIKE

1. The mapper shows the workbook as sheets, names the cover page and the decoy as not data, and asks which sheets hold donors and which hold gifts, or works it out from the columns and says so.
2. Headers found on row 3 and row 2 with the reason on screen. Merged title rows shown, not imported.
3. Donors and gifts joined on a normalised ID. Orphans refused by row, 500 of them, not invented.
4. Subtotal and total rows recognised and excluded, with the GRAND TOTAL used to reconcile.
5. Two date conventions, one per sheet, each inferred and stated.
6. Net cash within refusals of **$52,376,921.72**, with in-kind, pledges and the soft-credit column on their own lines.
7. The decoy sheet not imported, or imported only after an explicit choice, and never silently.
8. All 800 exclusions caught, including the 40 hidden rows, the 100 yellow rows and the 40 comments, because the legend was read. If the product cannot read a legend, it says "this workbook has hidden rows, coloured rows and comments; here is what they contain; tell us what they mean."
9. 300 duplicate people merged with the review list showing each fold.
10. The drift list near the planted set less exclusions, the 100 failed sustainers on recovery, the 60 stale-Active ones recognised from the pattern.
11. **It finishes.** 25,000 donors and 92,000 gifts through the browser in a time you would sit through in a demo, with the summary at the end, and the org left clean if it fails halfway.

## FIXTURE DEFECTS FOUND ON THE SEPT 7 RUN (Cowork's, not Steward's)

- **896 legacy rows carry a trailing minus on a positive gift** (`1,234.00-`). The generator meant "odd formatting"; a trailing minus is a real negative convention and an honest reader must treat it as one. Steward routed them as negatives, $494,556.03, and was right. The net cash figure above ($52,376,921.72) counts them as positive. Until the generator is fixed, the honest-reader reconciliation is: key net cash, minus 500 orphans refused, minus $494,556.03 trailing-minus rows routed, plus $122,861.28 of real refunds routed rather than subtracted. Do not "fix" the parser to match the key.
- The `Old export` figure in the table above was cash-only; the column's signed sum is $4,329,708.73 and its positives-only sum is $4,342,760.71. All three are listed in the totals table.
- BUILD-82's verification named $53,231,102.55 as net cash. That number was wrong; this key's $52,376,921.72 is the generator's figure.
