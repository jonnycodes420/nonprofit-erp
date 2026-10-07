# FIX-33 import scorecard: steward-test-1000-donors-messy.csv

The file was imported locally into a fresh scratch org through the same steps the DonorImport page takes:
`analyzeCsvText`, the automatic mapping (`autoDetectTxMapping`), the mapper plan's flag columns, the
accounted builder (`buildTransactionRows`) with the person's answer "month first" to the mixed date column,
then `POST /donors/import-combined` in 500-donor chunks with `identityResolved: true`. Graded against
`docs/fix-33/ANSWER-KEY.md`, which is derived from the raw CSV alone. The run is pinned as section 7 of
`tests/import-messy.test.js`.

"Expected" below uses Steward's held rule for a mixed date column (see the open decision at the end).

| | Expected | Before (origin/main 7579f4c) | After (fix-33-s5) |
|---|---:|---:|---:|
| Records after import | 1,032 (1,000 people + 32 pairs for review) | 1,083 | **1,032** |
| Certain duplicates merged at import | 28 of 28 | 3 | **28** |
| Uncertain pairs waiting in Data health | 32 of 32 | 7 | **32** |
| Uncertain pairs merged by the machine | 0 | 1 (Thomas Cook, D20039) | **0** |
| Gifts loaded | 3,888 | 3,315 | **3,888** |
| Gift dollars | $3,394,966.10 | $2,887,186.01 | **$3,394,966.10** |
| Refunds landed as negative gifts | 24 | 24 | 24 |
| Gift ID loaded twice | 0 | 0 | 0 |
| Deceased flagged | 3 | 3 | 3 |
| Deceased on calls to make, drift or Needs Your Attention | 0 | 0 | 0 |

## How each planted problem was handled (after)

- **Preamble line** ("Exported from DonorDB on 10/07/2026 by admin"): read as report chrome above the header. Never data.
- **TOTAL row** (line 4280) and the two blank lines: chrome, not gifts. 4,275 data rows read.
- **40 double-exported rows**: the builder sends both rows, the server keeps one gift per Gift ID. No Gift ID is in the database twice.
- **Refunds**: 25 negative rows, each noted "Refund". 24 land as negative gifts (-$7,862). The 25th (-$10,000 dated 25/06/2026) is refused with its line because of its day-first date.
- **Zero amounts**: 6 rows set aside as `zero_amount`, by line.
- **Missing amounts** ("n/a", blank): 9 rows set aside as `no_amount`, by line.
- **Bad dates** ("TBD", "00/00/0000", "13/45/2024", blank): refused as `unparseable_date`, by line. Never defaulted to today.
- **Future dates** (2027): 3 refused as `future_date`, 1 ("Pledge payment 2 of 4") skipped as a scheduled pledge payment.
- **Deceased**: the Deceased column is a flag column; Nancy Rodriguez, Richard Patel and Kenneth Bailey are flagged and appear on no call, drift or attention list. This already worked on main.
- **Do Not Email**: flagged on the 113 rows' donors (flag column).

## The 60 planted duplicates

Every planted record is a second Constituent ID (D2xxxx) for one true donor (D1xxxx). Certain means the same real
email and the same name once case and spacing are set aside (28). The other 32 differ in a way a person should judge:
a shortened first name (Mar / Maria, Bar / Barbara), a nickname (Sam / Samantha, Bill / William), a double surname
(Jackson-Nguyen / Jackson), or no email at all (matched only by phone or street). Those stay two records and appear
as likely pairs in Data health, each with its reason. Nothing uncertain is merged.

## What was wrong, and the fixes

1. **The automatic mapping missed five standard columns.** "E-mail Address", "Phone #", "Address Line 1", "ST" and
   "Fund/Designation" were proposed as new custom fields, so every donor arrived with no email, phone or street,
   the email half of dedupe never ran, and Data health had nothing to pair on. `autoDetectTxMapping` now also tests
   the tokenised header (`normalizeHeader`), still anchored to the whole header.
2. **"125.00 USD" was refused as unparseable.** 630 rows (617 after the copies). `normalizeMoney` read a leading
   currency code but not a trailing one; it now reads a known code after the number too.
3. **A couple form split a donor in two.** Under one Constituent ID the old system writes both "Jeffrey Morales" and
   "Jeffrey & Jessica Morales". The identity pass treated that id as shared by two people and refused to group on it,
   so 50 real donors became two records each. Under the same source id, a couple form that names the person is now
   the same record. An email or a name alone still never folds a couple into a person.
4. **Whether a twin merged depended on the chunk it fell in.** Across a 500-donor chunk, the server matched an
   incoming person to an existing one by email alone when only one record held that email, so "Sam Sanchez" (D20001)
   was folded into "Samantha Sanchez" (D10610) only because she was committed in chunk one. When the two carry
   different ids from the old system, the email match now also needs a compatible name.
5. **Data health could not see two of the pair shapes.** "Bar Morales" / "Barbara Morales" (a 7-digit phone, so
   no phone key) and "Alexander Sanders-Johnson" / "Alexander Sanders" (same street, no email) were invisible to the
   duplicate queue. `nameRelation` now knows a first name cut short and a double surname; both only make a pair.

## Prod's 1,024

Prod showed 1,024 imported people. This run reproduces 1,083 from main with the page's automatic mapping and no
corrections; the difference is the mapping choices made on the screen in prod (mapping the email column by hand,
for example, folds the certain twins inside one chunk). The cause of the extra people is the same: missed planted
duplicates and donors split by their couple form.

## Open: one decision for Jonathan

**320 gift rows ($314,776.19) carry a day-first date such as 20/10/2023 in a column whose other 1,271 slash dates
can only be month first.** Steward's held rule (BUILD-80) blocks a mixed column until the person answers, and under
her answer a cell that is impossible that way is refused with its line rather than re-read. A cell whose first number
is over 12 has only one valid reading, so reading it day first would not be a guess, but it changes a written rule,
so it is left for a decision. If accepted, the key's full figure is 4,208 gifts ($3,709,742.29, 25 refunds).
