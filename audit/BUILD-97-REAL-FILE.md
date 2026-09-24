# BUILD-97 Part 1 — one real file, end to end

**Status: PENDING. No real export has been supplied.**

Part 1 says: *"Nothing else in this build matters until this part is green on a
real export."* That sentence is honoured here by refusing to fill this file in
with anything else. Every figure below is `PENDING`, and each one is a number a
human reads off the file by hand and writes down — not a number the product
computed and this document copied. A reconciliation where both sides come from
the same code proves nothing.

**What is waiting:** the Justin's Place Salesforce reports (Contacts and
Opportunities). Jonathan's own 444-row prospect org is a rehearsal and is
recorded as such if it is used first — see `BLOCKED-build97.md` §2.

**What was built anyway, because it does not depend on the file:** the
Salesforce NPSP preset (`shared/npspPreset.js`), a fixture built from NPSP's
documented export shape (`tests/fixtures/build97/`), and
`tests/build97-npsp.test.js` (79 assertions). The preset's own `confidence` is
**`documented-not-walked`** and it says so on screen. **Do not treat it as
proven until this file is filled in.**

---

## 0 · The file

| | |
|---|---|
| Organisation | PENDING |
| Source system | PENDING (expected: Salesforce NPSP) |
| Files received | PENDING |
| Date received | PENDING |
| Rows in each file, counted in a spreadsheet | PENDING |
| Who read the figures back | PENDING |

## 1 · The totals, read off the file by hand

Read these in a spreadsheet **before** importing. `SUM` the Amount column,
filter to `Closed Won`, and `SUM` again. Both numbers matter: the difference
between them is what an importer that sums the column would have overstated by.

| Figure | From the file (by hand) | From Steward after import | Agree? |
|---|---|---|---|
| Rows in the gift file | PENDING | PENDING | — |
| Total of the Amount column, in cents | PENDING | PENDING | — |
| Total at stage `Closed Won` only, in cents | PENDING | PENDING | — |
| Donor count (distinct people + organisations) | PENDING | PENDING | — |
| People (not organisations) | PENDING | PENDING | — |
| Organisations | PENDING | PENDING | — |

**The household check, and it is the one to do first.** Count the contacts whose
`Account Name` ends in "Household". If Steward's organisation count is anywhere
near that number, the household trap has been walked into and the whole file has
left the person surfaces. Expected: those rows are PEOPLE.

## 2 · The exclusions, each checked

Every row Steward set aside, with the reason it gave, checked against the file.
A row set aside for the wrong reason is a bug filed, not a note.

| Reason | Rows | Dollars | Checked against the file? |
|---|---|---|---|
| Deceased | PENDING | PENDING | PENDING |
| Do not contact | PENDING | PENDING | PENDING |
| Recurring / sustainer | PENDING | PENDING | PENDING |
| Pledge (a commitment, not money received) | PENDING | PENDING | PENDING |
| In-kind | PENDING | PENDING | PENDING |
| Single-gift donor (cannot drift) | PENDING | PENDING | PENDING |
| Stage says the money never arrived | PENDING | PENDING | PENDING |
| A stage Steward does not know | PENDING | PENDING | PENDING |

**An unknown stage is the line to read first.** Any Salesforce admin can add or
rename a stage. Steward refuses to guess and lists them by name; each one needs
an answer from the organisation — *is this money that arrived?* — before the
import is trusted.

## 3 · The reconciliation invariant

The BUILD-72 equation, asserted by the importer before it commits, restated
here against hand-read numbers:

```
rows_in_file    = gifts_created + rows_skipped + rows_errored
dollars_in_file = dollars_created + dollars_skipped + dollars_errored
```

| Side | Value | |
|---|---|---|
| rows_in_file | PENDING | |
| gifts_created + skipped + errored | PENDING | must be equal |
| dollars_in_file (cents) | PENDING | |
| created + skipped + errored (cents) | PENDING | must be equal |

## 4 · Every screen, read back

Open each surface and read the figure on it against §1. A screen that disagrees
with the file is a bug filed and fixed, not a note.

| Surface | What it should say | What it says | Agree? |
|---|---|---|---|
| Import summary (the receipt) | PENDING | PENDING | — |
| Home — the morning sentence | PENDING | PENDING | — |
| The Thread | PENDING | PENDING | — |
| Drift — count and dollars at risk | PENDING | PENDING | — |
| Drift — every flagged donor's reason, checked against their own rows | PENDING | PENDING | — |
| Dashboards → Board — giving this year | PENDING | PENDING | — |
| Donor directory — count | PENDING | PENDING | — |
| Institutional giving (organisations) | PENDING | PENDING | — |
| Bookkeeper export — total, and it must foot in cents | PENDING | PENDING | — |

## 5 · Drift, donor by donor

Drift makes a claim about a specific person's pattern. Each flagged donor's
reason is checked against their own rows in the file — not spot-checked.

| Donor | Drift's sentence | Their rows in the file | Correct? |
|---|---|---|---|
| PENDING | | | |

## 6 · Receipts are OFF

**Asserted before the import runs, not after.** A real file of real donors
imported into an org with receipting enabled issues real tax documents to real
people for gifts that arrived years ago.

| | |
|---|---|
| `orgs.receipts_enabled` before the import | PENDING (must be `false`) |
| `orgs.emails_enabled` before the import | PENDING |
| Receipts issued by the import | PENDING (must be `0`) |
| Emails sent by the import | PENDING (must be `0`) |

## 7 · Bugs found

Every discrepancy in §1–§6 is a bug filed and fixed, per Part 1's own rule —
this table is the list, and an empty table means the run was clean, not that
nobody looked.

| # | What disagreed | Cause | Fixed in |
|---|---|---|---|
| — | PENDING | | |

---

## Done when

Every `PENDING` above is a number, every "Agree?" is yes, and every row of §7
names a commit. Until then the NPSP preset stays `documented-not-walked`, and
nothing in this build claims otherwise.
