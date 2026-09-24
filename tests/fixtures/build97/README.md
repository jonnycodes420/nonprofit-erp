# tests/fixtures/build97 — the Salesforce NPSP fixture, and what it should produce

**Status: HAND-BUILT FROM DOCUMENTATION, NOT RECORDED FROM A REAL ORG.**
That is stated first because it is the most important thing about this file.
`tests/external-fixture-provenance.test.js` exists because a hand-typed mock
lied for three builds, and it sanctions `tests/fixtures/external/*.json` only
for payloads *recorded from a live service*. This fixture is deliberately NOT
there: no real Justin's Place export was in hand when the preset was written
(see `BLOCKED-build97.md` §2), so it carries the same status as every other
import fixture in this directory — a shape built from published documentation,
useful for proving the LOGIC and worth nothing as proof that a real file looks
like this.

**The preset's own `confidence` is `documented-not-walked` and says so on
screen.** When the real export arrives, the audit in
`audit/BUILD-97-REAL-FILE.md` is what promotes it — not this file.

## The two files

Salesforce exports the Nonprofit Success Pack in two shapes, and a real
migration is both: a **Contact** report (the people) and an **Opportunity**
report (their gifts). Steward already reads a donor sheet and a gift sheet in
one pass, so these are two CSVs, not a new importer.

Both are written in **report-label** spellings ("Total Gifts", "Close Date")
rather than API names (`npo02__TotalOppAmount__c`, `CloseDate`), because that
is what a fundraiser gets from Reports → Export. The preset recognises BOTH,
and the suite asserts the API spellings too.

## `npsp-contacts.csv` — 8 rows

| # | Contact | Account Name | Account Record Type | What it is here to test |
|---|---|---|---|---|
| 1 | Allie Barnett | Barnett Household | Household Account | **The trap.** A household account is NOT an organisation |
| 2 | Marcus Reyes | Reyes Household | Household Account | An ordinary person |
| 3 | Dolores Whitfield | Whitfield Household | Household Account | `Deceased` TRUE + `Do Not Contact` TRUE |
| 4 | Priya Nandakumar | Nandakumar Household | Household Account | `Email Opt Out` TRUE — reachable by post, never by email |
| 5 | Ruth Calloway | **Sunrise Foundation** | Organization | An organisation; the CONTACT is Ruth, the DONOR is the foundation |
| 6 | Henry Oyelaran | **Cedar Grove Trust** | Organization | An organisation with no money received yet |
| 7 | Tom Okafor | Okafor Household | Household Account | A person with no gifts |
| 8 | Grace Lim | Lim Household | Household Account | A prospect |

**Six people, two organisations.** If an import of this file produces eight
organisations, the household trap has been walked into: `Account Name` became
the donor for every row and the whole file left the person surfaces.

## `npsp-opportunities.csv` — 12 rows, $42,465 in the Amount column

The stage decides whether an amount is money that ARRIVED. Every row lands in
exactly one bucket, so `rows_in_file = cash + pledge + in-kind + not_received`
holds — which is the BUILD-72 reconciliation invariant applied to a stage
column.

| Bucket | Rows | Dollars | Which |
|---|---|---|---|
| **Cash** (`Closed Won`) | 6 | **$26,960.00** | Zz001 500, Zz002 250, Zz003 1,000, Zz004 25,000, Zz008 150, Zz009 60 |
| **Pledge** (`Pledged`, `Promised`) | 2 | **$10,040.00** | Zz005 10,000, Zz011 40 |
| **In-kind** (`In-Kind Type` present) | 1 | **$300.00** | Zz010 — *and it is `Closed Won`* |
| **Not received** | 3 | **$5,165.00** | Zz006 Closed Lost 75, Zz007 Prospecting 5,000, Zz012 **unknown stage** 90 |
| **Total** | **12** | **$42,465.00** | |

### The three decisions this table encodes

1. **Only `Closed Won` is cash.** $15,205 of the file — a third of it — is
   money that has not arrived. An importer that sums the Amount column
   produces $42,465 and a board report that is wrong by $15,505.

2. **In-kind outranks the stage.** Zz010 is `Closed Won` and is NOT cash: it
   is a signed print for a gala auction. A Closed Won in-kind gift is still
   not money, and Steward already has a bucket for it.

3. **An unknown stage is never cash.** Zz012 sits at `Awaiting Board Review`,
   a stage this imaginary org added itself — which every Salesforce admin can
   do. It is set aside BY NAME so the review step can ask "27 rows at a stage
   called X — are these gifts?" rather than silently adding or silently
   dropping them. Guessing in either direction is a number nobody can defend.

### Fund

`Primary Campaign Source` is the fund: Spring Appeal 2026 (4 rows), Year End
2025 (1), Year End 2024 (1), Capacity Grant (2), Major Gifts (1), Monthly
Giving (1), blank (1).

### Dates

Every Close Date is in the past relative to the fixture's writing (23 Sep
2026), so nothing is refused as future-dated and nothing here depends on what
day the suite runs. There is no clock in this fixture to synchronise.
