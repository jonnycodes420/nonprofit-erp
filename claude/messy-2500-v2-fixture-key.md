# steward-messy-2500-v2.csv — what is planted in it

Seed `20260905`, anchored to 2026-09-05. Regenerate rather than hand-edit.

**v1 tested cells. v2 tests the file and the money.** Every cell-level trick from v1 is still here at lower density, because a fixture that stops testing something is how a fix regresses. What is new is the structure of the file (it is a report export, not a data export), the meaning of the rows (soft credits, pledges, in-kind, matching gifts, refunds and duplicates that all *look* like gifts), and a date convention that is wrong for a US parser on every slash date in the file.

Every line below is something the file was built to contain. Where Steward disagrees with a line, either the engine is wrong or the case is genuinely ambiguous, and which of those it is, is the finding.

---

## THE FILE

| | |
|---|---|
| Bytes | 438,319, UTF-8 **with BOM**, and **4 lines carry raw CP1252 bytes** (Christian García on lines 1541, 1542 and 1545; Stephanie Müller on line 1913, one of them mixing mojibake and a raw byte in the same cell) so a strict UTF-8 decode throws and a lenient one silently writes U+FFFD into a donor's name |
| Physical lines | 2,853 |
| Data records | **2,500** (rows a correct CSV parser yields, minus report chrome) |
| Why they differ | 336 cells contain embedded newlines inside quotes (addresses with an apartment line, notes with a second paragraph). A line counter is not a row counter |
| Report chrome | line 1 is a report title, line 2 is `Generated 05/09/2026 8:14 AM by jmoore`, line 3 is blank, line 4 is the real header. The header **repeats three more times** after `Page N of 4` lines. One stray blank line mid-data. The file ends with a blank line, a `TOTAL` row carrying **$2,035,978.52** in the Amount column, and `End of report` |
| Columns | 22. `Constituent ID`, `Name`, `First Name`, `Last Name`, `Spouse`, `Email`, `Phone`, `Address`, `City`, `State`, `ZIP`, `Gift ID`, `Gift Date`, `Amount`, `Receipt Amount`, `Gift Type`, `Fund`, `Appeal`, `Frequency`, `Solicit Code`, `Status`, `Notes` |
| Name strings | 761 distinct, collapsing to a true population of **509** records, of which 46 are spouses who appear only as soft credits and 20 are organisations |

**The TOTAL row is the source system's own net cash figure over unique gift IDs.** It is the first number Steward should be compared against, and it was not computed by Steward. That is what makes it worth something.

---

## RECONCILIATION — WHAT BALANCED HAS TO MEAN HERE

**The first number to check is the sum of every amount cell in the file, before any disposition: $2,327,646.22 in absolute value, $2,311,946.22 signed.** That includes duplicates, soft credits, pledges and in-kind. Imported plus refused plus non-cash, over every row, must land on it. If imported plus refused alone exceeds it, dollars are being counted in two dispositions.


| | Rows | Dollars |
|---|---|---|
| Source system net cash (the TOTAL row) | | **$2,035,978.52** |
| Cash rows Steward cannot parse and must **refuse with a line number** | 33 | $30,886.36 |
| **Expected imported net cash if everything is right** | | **$2,005,092.16** |
| Refunds inside that (7 negative rows; the 3 positive `Reversal` rows are counted as cash because their sign says so) | 7 | -$7,850.00 |
| Exact duplicate rows that must be dropped, or the total inflates by | 15 | $16,030.60 |
| Soft credit rows: **not money**, never in the total | 60 | $35,016.60 |
| Pledge commitment rows: **not money** | 12 | $184,000.00 |
| Pledge payment rows: money, already in the total | | $147,625.00 |
| In-kind rows: FMV, **not cash** (7 have no amount at all) | 25 | $38,900.00 |
| Corporate matching gifts: money, from the corporation, attributed in Notes | 30 | $18,346.61 |
| Same-day same-amount twins with different gift IDs: **both real** | 10 | |
| Legacy-migration twins, note says "may duplicate": **ambiguous, human decides** | 6 | |

The three ways to get the wrong total, in order of how likely they are: counting soft credits (+$35,016.60), counting the pledge and its payments (+$184,000.00), and keeping the 15 exact duplicates (+$16,030.60). Any of the three produces a summary screen that says Balanced against itself and is wrong against the TOTAL row.

---

## THE DATE TRAP — READ THIS FIRST

**Every slash date in this file is dd/mm/yyyy.** The org ran a UK-configured system. The title line says so (`Generated 05/09/2026` is 5 September), and 828 of the 1,581 slash dates have a first component above 12, which is impossible under mm/dd.

| | |
|---|---|
| Slash-format rows | 1,581 |
| Unambiguous (day > 12): a US parser **refuses** these as invalid months | 828 |
| Ambiguous (day ≤ 12): a US parser **accepts** these | 753 |
| Of those, silently wrong under mm/dd, by up to eleven months | **688** |

The correct behaviour is not a better guess per cell. It is noticing at the column level that half the slash dates are impossible under the default convention, inferring dd/mm for the whole column, and saying so on the summary. Refusing 828 rows and quietly misdating 688 more is the worst outcome, and it is the one a per-cell parser produces. A donor whose March gift lands in a different month is a donor whose drift is now wrong.

Also present: 96 ISO datetimes with a `Z`, about a third at `03:00:00Z`, which is the previous civil day in Eastern time. The BUILD-75 seam says a gift date is a civil date and never converts. Assert that a `2025-06-13T03:00:00.000Z` gift is 13 June, not 12 June.

Two-digit years are `d/m/yy`, some with a trailing ` 0:00`. Excel serials, `March 15th, 2024`, `2024.03.15`, `20240315` and `15 Sep 2025` are all present.

### Planted unparseable and impossible dates
Each must be an error with a line number, never today, never silently dropped.

- `Q4 2023` on gift `G-4308` (Wainwright, David), true date 2024-09-19: unparseable period
- `FY24` on gift `G-6688` (Whitaker Bank Foundation), true date 2024-08-06: unparseable period
- `Christmas 2022` on gift `G-7844` (Mr. and Mrs. Catherine Nguyễn), true date 2023-09-04: unparseable
- `12/31/1899` on gift `G-7677` (larry everhart), true date 2022-12-12: Excel epoch zero, not a real gift date
- `01/01/1900` on gift `G-5293` (Anna Haddad), true date 2025-08-01: Excel serial 1, not a real gift date
- `29/02/2023` on gift `G-7497-SC` (Mr. and Mrs. Matthew Vasquez), true date 2024-12-09: invalid leap day
- `30/02/2024` on gift `G-5345` (sharon moreau), true date 2026-03-15: impossible date
- `00/00/0000` on gift `G-5874` (Jeremy Featherstone), true date 2026-06-15: unparseable
- `` on gift `G-4430` (priya wainwright), true date 2025-12-10: blank
- `05/01/31` on gift `G-5631` (Aisha S. Ó Briain), true date 2025-06-01: two-digit year: 5 Jan 1931 under dd/mm, never 2031
- `31/12/26` on gift `G-6328` (Gallagher, Scott), true date 2024-07-23: 31 Dec 2026, FUTURE, must error
- `15/09/2026` on gift `G-4486` (MATEO LATTIMORE), true date 2025-09-04: 15 Sep 2026, ten days in the future, must error
- `Unknown` on gift `G-6540` (Kimberly Ulmer), true date 2025-03-11: unparseable
- `2024-02-30` on gift `G-7779` (Bancroft, Kwame), true date 2021-03-20: impossible ISO date

---

## STRUCTURE — THINGS THAT BREAK THE PARSER BEFORE IT SEES A CELL

- **BOM.** The first header cell is `\ufeffConstituent ID` to a parser that does not strip it, and then no column named `Constituent ID` exists.
- **Raw CP1252 bytes** on 4 lines across 2 donors (Christian García ×3, Stephanie Müller ×1). Corrected from an earlier draft that said 6 names; 6 donors were tagged, the generator emitted raw bytes on 4 of their rows. Strict UTF-8 throws on the whole file. Lenient UTF-8 writes `�` into the name and calls it imported. Neither is right. The right answer is to detect, decode as CP1252 for those bytes, and say so.
- **Three repeated header rows** mid-data, each preceded by a blank line and a `Page N of 4` line. A parser that treats every row after line 4 as data imports the word `Amount` as an amount three times.
- **Column shift**, 5 rows: the Address cell is missing entirely, so Gift Date lands in ZIP, Amount lands in Gift Date, and the row has 21 cells. Gift IDs `G-6514`, `G-4210`, `G-8053`, `G-7877`, `G-4747`.
- **Extra column**, 4 rows: an unquoted comma inside Notes pushes a fragment into a 23rd cell. Gift IDs `G-5204`, `G-7692`, `G-5041`, `G-5654`.
- **Short row**, 3 rows: 14 cells, nothing after Amount. Gift IDs `G-5318`, `G-6515`, `G-6678`.
- **Zero-width space** (U+200B) prefixed to one email address. It looks identical and does not match.
- **Non-breaking-space thousands separator** on every amount for **Dylan Søndergaard** (`1 500,00`). French-Canadian Excel.
- **European decimal comma** on every amount for **Stephanie Müller** (`1.250,00`). A US parser reads this as one dollar twenty-five. The convention is consistent within the donor, which is the clue.
- Tabs and trailing whitespace inside Amount and Name cells. `'1000.00` with a leading apostrophe, which is Excel forcing text.
- The `Receipt Amount` column is filled on 40 gala rows and differs from `Amount` by $85 or $120 (the non-deductible dinner). `Amount` is the gift. `Receipt Amount` is a custom field or nothing. It is never the gift.

### Planted unparseable amounts
- `$1,5000` on gift `G-6783` (Valvoline), true amount $250.00: misplaced comma
- `1e3` on gift `G-6233` (Gallagher, Scott), true amount $20.00: scientific
- `500 (pledge)` on gift `G-6527` (Nicole Grantham), true amount $6,250.00: annotated
- `1,000.00.` on gift `G-7517` (Mary Ivester), true amount $100.00: trailing period
- `$` on gift `G-6099` (samuel quarles), true amount $50.00: symbol only
- `one hundred` on gift `G-6478` (Whitfield, Isabella), true amount $5,000.00: words
- `100..00` on gift `G-4340` (Jean Kirtland), true amount $2,000.00: double point
- `$25O.00` on gift `G-7777` (donald hutchinson), true amount $1,500.00: letter O for zero

Refunds are written three ways: `1,000.00-` (trailing minus, 4 rows), `CR 1,000.00` (3 rows), and **three rows with Gift Type `Reversal` and a positive amount**. On those three, the type says money left and the sign says it arrived. That is genuinely ambiguous and the finding is whether Steward noticed.

---

## MEANING — ROWS THAT LOOK LIKE GIFTS AND ARE NOT

- **Soft credits, 60 rows.** Same date and amount as a real gift, Gift Type `Soft Credit`, gift ID either identical to the base gift or suffixed `-SC`. 46 are credited to a spouse who exists only through these rows; 14 are credited to board members who also have real gifts. Not money. But the spouse is a real household member and the relationship is worth keeping.
- **Pledges, 12.** One `Pledge` row for the commitment, then `Pledge Payment` rows. Six fully paid, two overpaid, two with zero payments, two active. Pledge + payments double counts. The two active pledgers are contractual and excluded from drift.
- PLEDGE $50,000 FULLY PAID (8 payments). Counting pledge + payments double-counts to $100,000: **Nicole Grantham**
- PLEDGE $10,000 FULLY PAID (5 payments). Counting pledge + payments double-counts to $20,000: **Kimberly Ulmer**
- PLEDGE $25,000 FULLY PAID (8 payments). Counting pledge + payments double-counts to $50,000: **James Patel**
- PLEDGE $25,000 FULLY PAID (4 payments). Counting pledge + payments double-counts to $50,000: **Hiroshi Fennimore**
- PLEDGE $12,000 FULLY PAID (4 payments). Counting pledge + payments double-counts to $24,000: **Daniel Okafor**
- PLEDGE $5,000 FULLY PAID (8 payments). Counting pledge + payments double-counts to $10,000: **Keith Pennington**
- PLEDGE $5,000 OVERPAID (5 of 4 scheduled payments). Cash is the payments; the pledge row is a commitment: **Teresa Culpepper**
- PLEDGE $5,000 OVERPAID (9 of 8 scheduled payments). Cash is the payments; the pledge row is a commitment: **Priya D'Angelo**
- PLEDGE $5,000 WITH ZERO PAYMENTS. Not cash. Do not count the commitment as a gift: **Kyle Çelik**
- PLEDGE $12,000 WITH ZERO PAYMENTS. Not cash. Do not count the commitment as a gift: **Richard Stoddard**
- ACTIVE PLEDGE $25,000, 1 of 4 paid. Contractual cadence, excluded from drift: **Frances Ibáñez**
- ACTIVE PLEDGE $5,000, 2 of 4 paid. Contractual cadence, excluded from drift: **Harold Bergström**
- **In-kind, 25 rows.** Gift Type `In-Kind`, amount is fair market value or blank, description in Notes. Not cash. The blank ones must not be counted as $0 gifts either.
- **Corporate matching gifts, 30 rows.** From Acme, Toyota, Ashland, Valvoline and Lexmark, dated 20 to 75 days after the matched gift, with `Match for Jane Smith` or `MG: Smith, Jane` in Notes. The money is real and the corporation is the donor of record. The relationship belongs to the person. Steward has to decide, and say, which record carries it.
- **DAF grants, 8 rows.** From Fidelity Charitable, Schwab Charitable and National Christian Foundation, with the recommending donor named in Notes. Same question, higher dollars.
- DAF DONOR: gifts arrive from National Christian Foundation with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Sarah Redgrave**
- DAF DONOR: gifts arrive from Schwab Charitable with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Michael Fernandes**
- DAF DONOR: gifts arrive from National Christian Foundation with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Anthony Nakamura**
- DAF DONOR: gifts arrive from Schwab Charitable with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Scott Zabala**
- DAF DONOR: gifts arrive from Schwab Charitable with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Vincent Çelik**
- DAF DONOR: gifts arrive from National Christian Foundation with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Debra Ivester**
- DAF DONOR: gifts arrive from National Christian Foundation with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Richard Quarles**
- DAF DONOR: gifts arrive from Fidelity Charitable with this person named in Notes. The DAF is the legal donor; this person is the relationship. Steward has to decide which record carries the history: **Priya Abernathy**
- **Anonymous, 15 rows** under `Anonymous`, `ANONYMOUS DONOR`, `Anon.` and `Cash donor`. Different people. Never one donor with a cadence, never on a drift list.
- **Estates, 3.** A donor marked deceased in the Status column, then `Estate of <name>` gives a bequest a year later under a separate name. The estate must not un-decease the person and must never be solicited.
- ESTATE of a deceased donor. Not the same record as Aisha Ivester. Must not un-decease the person, must never be solicited: **Estate of Aisha Ivester**
- ESTATE of a deceased donor. Not the same record as Dorothy Ackerly. Must not un-decease the person, must never be solicited: **Estate of Dorothy Ackerly**
- ESTATE of a deceased donor. Not the same record as Leila Marchetti. Must not un-decease the person, must never be solicited: **Estate of Leila Marchetti**
- **Organisations, 20.** Churches, foundations, banks, corporations. A grant cycle is not a giving cadence.
- **One weekly giver**, about 200 rows of $20 over four years. Sanity-check the row count per donor before believing a top-donors list.

---

## EXCLUSIONS — SPREAD ACROSS THREE HOMES ON PURPOSE

The state lives in `Solicit Code`, in `Status`, and in `Notes`, in that order of reliability, and they contradict each other. Every one of these must be excluded from every ask surface.

### Deceased (15 + 3 estate persons)
- DECEASED via Notes only: **Jennifer Sowande**
- DECEASED via Solicit Code 'DEC' only: **Betty Kowalski**
- DECEASED via Notes only: **Catherine Kingsley**
- DECEASED via Solicit Code 'DEC' only: **Kimberly Müller**
- DECEASED via Status column only: **Jean Lattimore**
- DECEASED via Notes only: **Sean Coventry**
- DECEASED via Status column only: **Carolyn Haddad**
- DECEASED via Notes only: **Matthew Ellingsworth**
- DECEASED via Status column only: **Jeremy Jefferies**
- DECEASED via Solicit Code 'DEC' only: **Teresa Oyelaran**
- DECEASED via Status column only: **Nancy Singh**
- DECEASED via Solicit Code 'DEC' only: **Grace Delacroix**
- DECEASED via Status column only: **Priya Jessup**
- DECEASED via Notes only: **Kwame Bancroft**
- DECEASED via Notes only: **Deborah Adebayo**
- DECEASED (Status column). Estate gives after death under a separate name: **Aisha Ivester**
- DECEASED (Status column). Estate gives after death under a separate name: **Dorothy Ackerly**
- DECEASED (Status column). Estate gives after death under a separate name: **Leila Marchetti**

### Contradictions (4)
- CONTRADICTION: Status=Active, Solicit=OK, Notes say deceased. The note wins. Assert the product does not trust the column: **Diana Oyelaran**
- CONTRADICTION: Status=Active, Solicit=OK, Notes say deceased. The note wins. Assert the product does not trust the column: **Hannah Nguyễn**
- CONTRADICTION: Status=Active, Solicit=OK, Notes say deceased. The note wins. Assert the product does not trust the column: **Margaret Jessup**
- CONTRADICTION: Status=Active, Solicit=OK, Notes say deceased. The note wins. Assert the product does not trust the column: **Brian Ogletree**

### Do not solicit (16)
- DO-NOT-SOLICIT via Solicit Code 'NC': **Evelyn Pemberton**
- DO-NOT-SOLICIT via Solicit Code 'DNS': **Ronald Pemberton**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Sara Stoddard**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Bradley Kirtland**
- DO-NOT-SOLICIT via Solicit Code 'DNS;DNM': **Nicole Ulmer**
- DO-NOT-SOLICIT via Solicit Code 'dns': **Natalie Okafor**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Mateo Castellanos**
- DO-NOT-SOLICIT via Solicit Code 'Do Not Solicit': **Angela Chen**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Aisha Ibáñez**
- DO-NOT-SOLICIT via Solicit Code 'D.N.S.': **Bobby Müller**
- DO-NOT-SOLICIT via Solicit Code 'DNS - spouse request': **Thomas Pennington**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Jack Haddad**
- DO-NOT-SOLICIT via Solicit Code 'No Contact': **Frank Ibáñez**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Harold Sowande**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Pamela Pemberton**
- DO-NOT-SOLICIT-ish via Notes only, several phrasings; two of them are partial (no phone but mail ok): **Albert Çelik**

### Do not mail or email, which is not the same flag (4)
- DO-NOT-MAIL/EMAIL via Solicit Code 'DNE'. Mail vs solicit vs email are different flags; assert the right one lands: **Larry Kensington**
- DO-NOT-MAIL/EMAIL via Solicit Code 'DNM'. Mail vs solicit vs email are different flags; assert the right one lands: **Helen Culpepper**
- DO-NOT-MAIL/EMAIL via Solicit Code 'NO MAIL'. Mail vs solicit vs email are different flags; assert the right one lands: **Susan Brannigan**
- DO-NOT-MAIL/EMAIL via Solicit Code 'DNM,DNE'. Mail vs solicit vs email are different flags; assert the right one lands: **Janice Hollingsworth**

### Inconsistent across a donor's own rows (4)
- INCONSISTENT: Solicit Code blank on most rows, 'DNS' on one row. The flag must propagate to the donor, not live on a gift: **Janice Tran**
- INCONSISTENT: Solicit Code blank on most rows, 'DNS' on one row. The flag must propagate to the donor, not live on a gift: **Kenneth Nolasco**
- INCONSISTENT: Solicit Code blank on most rows, 'DNS' on one row. The flag must propagate to the donor, not live on a gift: **Sophia Castellanos**
- INCONSISTENT: Solicit Code blank on most rows, 'DNS' on one row. The flag must propagate to the donor, not live on a gift: **Amy Ramirez**

### Newsletter only (5)
- NEWSLETTER ONLY: do not solicit, but keep mailing. Not the same as do-not-mail: **Emily Vandyke**
- NEWSLETTER ONLY: do not solicit, but keep mailing. Not the same as do-not-mail: **Joyce Bancroft**
- NEWSLETTER ONLY: do not solicit, but keep mailing. Not the same as do-not-mail: **Evelyn Vanterpool**
- NEWSLETTER ONLY: do not solicit, but keep mailing. Not the same as do-not-mail: **Patrick Ó Briain**
- NEWSLETTER ONLY: do not solicit, but keep mailing. Not the same as do-not-mail: **Peter Kowalczyk**

`Do not include in vendor mailing` is still planted in Notes as filler and is still a deliberate non-match.

---

## RECURRING — THE FREQUENCY COLUMN LIES BOTH WAYS

- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Brandon Caldwell**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Beverly D'Angelo-Ruiz**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Anna Haddad**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Sharon Moreau**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Benjamin Duong**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Jacob Isley**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Gloria Okafor**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Dmitri Haddad**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Douglas Ulmer**
- SUSTAINER, CARD STOPPED 3-6 months ago. Failed-payment recovery path, never drift, never lapsed: **Amanda Blackwood**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Alice Petrov**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Aisha Ó Briain**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Bobby Ravensworth**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Johnny Villalobos**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Jordan Coventry**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Catherine Hutchinson**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Fatima Whitaker**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Jeremy Featherstone**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Vincent Mulvaney**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Willie García**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Donald Ackerly**
- SUSTAINER, healthy, gave this month. Excluded from drift: **Anna Brantley**
- STALE FLAG: Frequency column says Monthly but the gifts are plainly annual. The pattern is the truth, not the column: **Maria Ogletree**
- STALE FLAG: Frequency column says Monthly but the gifts are plainly annual. The pattern is the truth, not the column: **Anthony Quimby**
- STALE FLAG: Frequency column says Monthly but the gifts are plainly annual. The pattern is the truth, not the column: **Joe Fitzgerald**
- STALE FLAG: Frequency column says Monthly but the gifts are plainly annual. The pattern is the truth, not the column: **Carol Hutchinson**
- STALE FLAG: Frequency column says Monthly but the gifts are plainly annual. The pattern is the truth, not the column: **Christian García**
- UNFLAGGED SUSTAINER: no Frequency, no Recurring type, but monthly cadence for 18+ months. Should be recognised as a sustainer from the pattern: **Christine Ramirez**
- UNFLAGGED SUSTAINER: no Frequency, no Recurring type, but monthly cadence for 18+ months. Should be recognised as a sustainer from the pattern: **Samuel Quarles**
- UNFLAGGED SUSTAINER: no Frequency, no Recurring type, but monthly cadence for 18+ months. Should be recognised as a sustainer from the pattern: **Natalie Kirkpatrick**

---

## DRIFT — THE CADENCE CASES

Fewer than v1 because v2 is about import, but enough that the drift list has a key. Some of these are also excluded above; the exclusion wins.

### Should drift, high confidence
- SEASONAL DRIFT (high conf, month-aware): every March 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Dylan Hollingsworth**
- SEASONAL DRIFT (high conf, month-aware): every November 2019-2024, window closed, nothing since. Inside 24 months so not lapsed: **Heather Coventry**
- SEASONAL DRIFT (high conf, month-aware): every March 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Jennifer Sowande**
- SEASONAL DRIFT (high conf, month-aware): every March 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Diana Oyelaran**
- SEASONAL DRIFT (high conf, month-aware): every April 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Betty Kowalski**
- SEASONAL DRIFT (high conf, month-aware): every November 2019-2024, window closed, nothing since. Inside 24 months so not lapsed: **Evelyn Pemberton**
- SEASONAL DRIFT (high conf, month-aware): every March 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Steven Barrowman**
- SEASONAL DRIFT (high conf, month-aware): every March 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **James Kowalski**
- SEASONAL DRIFT (high conf, month-aware): every April 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Catherine Kingsley**
- SEASONAL DRIFT (high conf, month-aware): every December 2019-2024, window closed, nothing since. Inside 24 months so not lapsed: **Kenneth Fitzgerald**
- SEASONAL DRIFT (high conf, month-aware): every December 2019-2024, window closed, nothing since. Inside 24 months so not lapsed: **Olivia Vandermeer**
- SEASONAL DRIFT (high conf, month-aware): every March 2020-2025, window closed, nothing since. Inside 24 months so not lapsed: **Larry Kensington**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Stephanie Fennimore**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Jose Ibáñez**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Heather Grantham**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Helen Culpepper**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Ronald Pemberton**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Kimberly Müller**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **David Wainwright**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Christina Sedgwick**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Jean Kirtland**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Alexander Salcedo**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Terry García**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Sara Hollingsworth**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Andrea O'Brien**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Janice Tran**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Sandra Yeardley**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Priya Wainwright**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Donald Ellingsworth**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Sara Stoddard**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Hannah Nguyễn**
- DRIFTING (quarterly, last gift 6 months ago = 2x cadence, under the 2.5x lapse line): **Jean Lattimore**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Bradley Kirtland**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Sean Coventry**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Charles Nightingale**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Nicole Ulmer**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Natalie Okafor**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Ryan Sandoval**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Carolyn Haddad**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Donald Olawale**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Peter Sedgwick**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Gabriel Bergström**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Noah Kowalski**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Matthew Ellingsworth**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Judy Bancroft**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Jeremy Jefferies**
- DRIFTING/declining (4x a year in 2024 and 2025, once in March 2026, nothing since): **Mateo Castellanos**

### Should not drift
- NOT DRIFTING: every March through 2026, window not yet closed or just given: **Andrew Çelik**
- NOT DRIFTING: every July through 2026, window not yet closed or just given: **Judy Villalobos**
- NOT DRIFTING: every January through 2026, window not yet closed or just given: **Paul Ó Briain**
- NOT DRIFTING: every March through 2026, window not yet closed or just given: **Debra Bancroft**
- NOT DRIFTING: every May through 2026, window not yet closed or just given: **Paul Sandoval**
- NOT DRIFTING: every March through 2026, window not yet closed or just given: **Heather Kensington**
- NOT DRIFTING: every May through 2026, window not yet closed or just given: **Kenneth Kensington**
- NOT DRIFTING: every June through 2026, window not yet closed or just given: **Nathan Devereaux**
- NOT DRIFTING: every March through 2026, window not yet closed or just given: **Timothy Pemberton**
- NOT DRIFTING: every July through 2026, window not yet closed or just given: **Margaret Whitfield**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Mateo Lattimore**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Janet Ellingsworth**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Kyle O'Brien**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Jacqueline Jessup**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Henry Vanterpool**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Nicholas Vandyke**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Jacqueline Sinclair**
- NOT DRIFTING (quarterly, last gift ~3 months ago, ratio ~1.0, inside the 1.25x threshold): **Dylan Søndergaard**

### Lapsed, not drifting
- LAPSED, not drifting (5 years silent): **Nicole Featherstone**
- LAPSED, not drifting (5 years silent): **John Trujillo**
- LAPSED, not drifting (5 years silent): **Julie Bancroft**
- LAPSED, not drifting (5 years silent): **Emily Vandyke**
- LAPSED, not drifting (5 years silent): **Kwame Vandermeer**
- LAPSED, not drifting (5 years silent): **Steven García**
- LAPSED, not drifting (5 years silent): **Logan Halvorsen**
- LAPSED, not drifting (5 years silent): **Amara Ó Briain**
- LAPSED, not drifting (5 years silent): **Harold Devereaux**
- LAPSED, not drifting (5 years silent): **Gary Fennimore**
- LAPSED, not drifting (5 years silent): **Harold Culpepper**
- LAPSED, not drifting (5 years silent): **Samuel Fitzgerald**
- LAPSED, not drifting (5 years silent): **Sean Caldwell**
- LAPSED, not drifting (5 years silent): **Emily Ó Briain**
- LAPSED, not drifting (5 years silent): **Patricia Ramirez**
- LAPSED, not drifting (5 years silent): **Michael Kowalski**
- LAPSED, not drifting (5 years silent): **Teresa Oyelaran**
- LAPSED, not drifting (5 years silent): **Kelly Müller**
- LAPSED, not drifting (5 years silent): **Joyce Bancroft**
- LAPSED, not drifting (5 years silent): **Arthur Underhill**

### Medium at most
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Jack van der Berg**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Amara Merriweather**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Hannah Salcedo**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Angela Quarles**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Michelle Devereaux**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Rebecca Kingsley**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Kathryn Yeardley**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Peter Nakamura**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Keith Nguyễn**
- MEDIUM AT MOST (erratic 2020/2022/2024). High confidence here is a bug: **Jennifer Kirkpatrick**

---

## IDENTITY — WHO IS WHO

- **Constituent ID** is blank on 90 people, in Excel scientific notation (`1.23E+05`) on some rows for 12 people, with leading zeros on some rows and stripped on others for 10 people, and **shared by two different people** in 3 pairs:
- CONSTITUENT ID 15766 SHARED by two different people (Olivia Vandermeer / Sara Hollingsworth). Legacy merge. Do not merge them on ID: **Olivia Vandermeer**
- CONSTITUENT ID 15766 SHARED by two different people (Olivia Vandermeer / Sara Hollingsworth). Legacy merge. Do not merge them on ID: **Sara Hollingsworth**
- CONSTITUENT ID 33226 SHARED by two different people (Sean Coventry / Vincent Çelik). Legacy merge. Do not merge them on ID: **Sean Coventry**
- CONSTITUENT ID 93134 SHARED by two different people (William Caldwell / Kenneth Nolasco). Legacy merge. Do not merge them on ID: **William Caldwell**
- CONSTITUENT ID 33226 SHARED by two different people (Sean Coventry / Vincent Çelik). Legacy merge. Do not merge them on ID: **Vincent Çelik**
- CONSTITUENT ID 93134 SHARED by two different people (William Caldwell / Kenneth Nolasco). Legacy merge. Do not merge them on ID: **Kenneth Nolasco**
- **Name versus First/Last disagree** on some rows for 8 people:
- NAME CONFLICT: Name column says Kimberly Müller, First Name column says 'Margaret' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Kimberly Müller**
- NAME CONFLICT: Name column says Donald Ellingsworth, First Name column says 'Steven' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Donald Ellingsworth**
- NAME CONFLICT: Name column says Cheryl Wainwright, First Name column says 'Barbara' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Cheryl Wainwright**
- NAME CONFLICT: Name column says Patrick Nakamura, First Name column says 'Samantha' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Patrick Nakamura**
- NAME CONFLICT: Name column says Grace Delacroix, First Name column says 'Noah' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Grace Delacroix**
- NAME CONFLICT: Name column says Laura Abernathy, First Name column says 'Cheryl' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Laura Abernathy**
- NAME CONFLICT: Name column says Brian Kensington, First Name column says 'Susan' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Brian Kensington**
- NAME CONFLICT: Name column says Isabella Gallagher, First Name column says 'Jennifer' on some rows. Which is the donor? The finding is what the product chose and whether it said so: **Isabella Gallagher**
- Twelve donors carry non-ASCII surnames (Nguyễn, Müller, García, Ó Briain, D'Angelo-Ruiz, O'Brien, Søndergaard, Çelik, Ibáñez, 李, Al-Rashid, van der Berg), each appearing in clean, mojibake and sometimes raw-byte forms across their own rows. One person, one record.
- Every donor's name style flips on roughly one row in eight: `Last, First`, `FIRST LAST`, `lower case`, `Mr. and Mrs.`, `The X Family`, a middle initial that was not there before, trailing tabs.
- Board members: 12, marked only in Notes (`Board member`, `BOARD`, `Trustee`, `Bd mbr`, and one `Former board (rotated off 2023)`).
- Email: uppercase, trailing space, two addresses in one cell, `jane at example dot com`, `none`, `@@`, missing TLD.
- ZIP: leading zeros stripped on Maine and Massachusetts addresses (`4101`, `2108`), `40390.0`, ZIP+4. State as `Ky`, `Ky.`, `Kentucky`, `kentucky`, `KY ` with a trailing space.

---

## WHAT A GOOD RUN LOOKS LIKE

1. The summary shows **2,500 in your file**, not 2,853, and not 2,517.
2. It names the column-level dd/mm inference and gives the count it applied it to.
3. It lands within refusals of $2,005,092.16 net cash, shows the 33 refused rows with line numbers, and reconciles to the TOTAL row with the difference explained.
4. Soft credits, pledges and in-kind are each shown as their own line with their own dollars, and none of them are in net cash.
5. The 15 exact duplicates are dropped and it says so. The 10 twins are kept and it says why.
6. Zero of the deceased and do-not-solicit names above appear on any ask surface, including the four whose Status column says Active.
7. The ten broken-card sustainers are on the recovery list, the three unflagged sustainers were recognised from the pattern, and the five stale-flag annual donors were not treated as monthly.
8. The estates and the DAF sponsors were handled as a decision, not an accident.
