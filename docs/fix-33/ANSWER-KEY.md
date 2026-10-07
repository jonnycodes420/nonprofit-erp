# FIX-33 answer key: steward-test-1000-donors-messy.csv

Derived from the raw CSV and the file's stated rules by `tests/fixtures/fix33/gen-answer-key.mjs`, which imports none of the code it grades. The ANSWER-KEY.md that came with the file was not on disk. Dates are judged against 2026-10-07, the day in the file's own preamble. Machine-readable copy: `tests/fixtures/fix33/answer-key.json`.

## The file

| | Lines |
|---|---:|
| Physical lines | 4280 |
| Preamble ("Exported from DonorDB ...") | 1 (line 1) |
| Header | 1 (line 2) |
| Blank lines | 2 (493, 759) |
| TOTAL row (not a gift) | 1 (line 4280) |
| Data rows | 4275 |
| Double-exported copies (same Gift ID, identical row) | 40 |
| **Gift rows after removing the copies** | **4235** |

The brief's 4,235 is confirmed: 4280 lines minus the preamble, the header, 2 blank lines and the TOTAL row is 4275 data rows, and 4275 minus 40 copies is 4235.

## What each of the gift rows is

| Disposition | Rows | Dollars |
|---|---:|---:|
| gift | 4183 | 3727604.29 |
| set aside: bad date | 8 | 7913.00 |
| set aside: no amount | 9 | 0.00 |
| gift (refund, negative) | 25 | -17862.00 |
| set aside: future date | 4 | 725.00 |
| set aside: zero amount | 6 | 0.00 |
| **gifts that should land** | **4208** | **3709742.29** |

Amounts read through $, commas, spaces and a currency code before OR after the number ("125.00 USD"). Refunds are the 25 negative rows (every one carries the note "Refund") and land as negative gifts. A slash date whose first number is over 12 (320 gift rows, e.g. 20/10/2023) has only one valid reading, day first; every other slash date reads month first, which 1,271 cells prove is the column's convention.

Under Steward's held rule for a mixed date column (the person answers "month first" and a cell that can only read day first is refused, never re-read), 320 of those gift rows ($314776.19) are refused with their line, leaving **3888 gifts ($3394966.10, 24 refunds)**. Whether to read those cells day first is a decision for Jonathan, not this key.

## Donors

1000 true donors (D1xxxx). The 60 planted duplicates are D2xxxx records, each the second record of exactly one true donor, found by a shared email, phone or street address. **Certain** means the same real email and the same name once case and spacing are set aside, so the import may merge it. Everything else is a question for a person (the Data health duplicate queue), never merged by the machine.

- Certain (merge at import): **28**
- For review (two records, shown as a likely pair): **32**
- People after a perfect import: 1000 once every pair is resolved; 1032 records straight after the import, with 32 pairs waiting in the queue.

| Planted | Name | Twin | Name | Shared | Verdict |
|---|---|---|---|---|---|
| D20000 | cynthia ruiz | D10477 | cynthia ruiz | email, phone, address, surname | certain |
| D20001 | sam sanchez | D10610 | samantha sanchez | email, phone, address, surname | review |
| D20002 | debra walker | D10392 | debra walker | email, phone, address, surname | certain |
| D20003 | justin cooper | D10768 | justin cooper | address, surname | review |
| D20004 | brenda carter | D10205 | brenda carter | email, phone, address, surname | certain |
| D20005 | anthony myers-price | D10060 | anthony myers | email, phone, address, surname | review |
| D20006 | scott moore | D10926 | scott moore | email, phone, address, surname | certain |
| D20007 | mar jones | D10594 | maria jones | email, phone, address, surname | review |
| D20008 | emily van | D10353 | emily van | email, phone, address, surname | certain |
| D20009 | renée la | D10824 | renée la | phone, address, surname | review |
| D20010 | gary long | D10858 | gary long | email, phone, address, surname | certain |
| D20011 | william jackson-nguyen | D10172 | william jackson | email, phone, address, surname | review |
| D20012 | helen hughes | D10455 | helen hughes | email, phone, address, surname | certain |
| D20013 | amy nguyen | D10883 | amy nguyen | email, phone, address, surname | certain |
| D20014 | mark anderson | D10479 | mark anderson | email, phone, address, surname | certain |
| D20015 | jennifer flores | D10437 | jennifer flores | phone, address, surname | review |
| D20016 | jeffrey & jessica morales | D10530 | jeffrey morales | email, phone, address, surname | certain |
| D20017 | betty cooper-buren | D10255 | betty cooper | email, phone, address, surname | review |
| D20018 | andrew sanchez | D10689 | andrew sanchez | email, address, surname | certain |
| D20019 | dan smith | D10606 | daniel smith | email, phone, address, surname | review |
| D20020 | larry cox | D10783 | larry cox | email, phone, address, surname | certain |
| D20021 | elizabeth peterson | D10202 | elizabeth peterson | phone, address, surname | review |
| D20022 | christopher rogers | D10269 | christopher rogers | email, phone, address, surname | certain |
| D20023 | maria collins-evans | D10230 | maria collins | email, phone, address, surname | review |
| D20024 | scott & jacob ramos | D10449 | scott ramos | email, address, surname | certain |
| D20025 | bre okafor | D10320 | brenda okafor | email, phone, address, surname | review |
| D20026 | george lewis | D10495 | george lewis | email, phone, address, surname | certain |
| D20027 | helen king | D10750 | helen king | phone, address, surname | review |
| D20028 | heather & kenneth parker | D10829 | heather parker | email, phone, address, surname | certain |
| D20029 | jason foster-perez | D10311 | jason foster | email, phone, address, surname | review |
| D20030 | frank okafor | D10638 | frank okafor | email, phone, address, surname | certain |
| D20031 | bill & karen howard | D10947 | william howard | email, phone, address, surname | review |
| D20032 | kimberly king | D10880 | kimberly king | email, phone, address, surname | certain |
| D20033 | helen hernandez | D10828 | helen hernandez | phone, address, surname | review |
| D20034 | laura smith | D10505 | laura smith | email, phone, address, surname | certain |
| D20035 | alexander sanders-johnson | D10055 | alexander sanders | address, surname | review |
| D20036 | jeffrey reed | D10195 | jeffrey reed | email, phone, address, surname | certain |
| D20037 | dor watson | D10529 | dorothy watson | email, phone, address, surname | review |
| D20038 | jason alvarez | D10548 | jason alvarez | email, phone, address, surname | certain |
| D20039 | thomas & david cook | D10850 | thomas cook | phone, address, surname | review |
| D20040 | andrew scott | D10438 | andrew scott | email, address, surname | certain |
| D20041 | donald brooks-turner | D10396 | donald brooks | email, phone, address, surname | review |
| D20042 | jacob la | D10821 | jacob la | phone, address, surname | review |
| D20043 | ann evans | D10700 | anna evans | email, phone, address, surname | review |
| D20044 | zoë ross | D10716 | zoë ross | email, phone, address, surname | certain |
| D20045 | brian jones | D10433 | brian jones | phone, address, surname | review |
| D20046 | john james | D10236 | john james | email, phone, address, surname | certain |
| D20047 | janet thompson-van | D10532 | janet thompson | email, phone, address, surname | review |
| D20048 | siobhan mcdonald | D10539 | siobhan mcdonald | phone, address, surname | review |
| D20049 | bar morales | D10412 | barbara morales | phone, address, surname | review |
| D20050 | susan anderson | D10239 | susan anderson | phone, address, surname | review |
| D20051 | mark james | D10557 | mark james | phone, address, surname | review |
| D20052 | diane roberts | D10498 | diane roberts | email, address, surname | certain |
| D20053 | zoë walker-buren | D10670 | zoë walker | email, phone, address, surname | review |
| D20054 | jason bennett | D10566 | jason bennett | email, phone, address, surname | certain |
| D20055 | joh cook | D10568 | john cook | email, phone, address, surname | review |
| D20056 | jerry flores | D10277 | jerry flores | email, phone, address, surname | certain |
| D20057 | jack anderson | D10662 | jack anderson | phone, address, surname | review |
| D20058 | betty garcia | D10192 | betty garcia | email, phone, address, surname | certain |
| D20059 | edward ramos-garcia | D10656 | edward ramos | email, phone, address, surname | review |

## Deceased

3 donors are marked deceased on at least one row: nancy rodriguez (D10013), richard patel (D10777), kenneth bailey (D10421). None may appear on a call list, a drift list or a suggested ask.

