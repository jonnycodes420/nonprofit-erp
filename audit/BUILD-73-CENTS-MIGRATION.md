# BUILD-73 — CENTS MIGRATION LOG

The brief asks for a row-by-row log of every value changed, before and after.
**No row's value was changed, and this file is the record of why not** — an
empty log with a reason is a finding; an empty log with no explanation is a
missing step.

## What Part 1 established (audit/BUILD-73-FINDINGS.md)

| Bucket | Count | Action |
|---|---:|---|
| 1 · truncation candidates WITH a Stripe reference | 2 | **Asked Stripe. Both exact.** Nothing to recover. |
| 2 · truncation candidates with NO Stripe reference | 7,569 | Unrecoverable by construction — and all demo/test/seed data. |
| 3 · receipts with a cents signature | 0 | Nothing issued wrongly. Nothing to reissue. |
| 4 · pledges / pledge payments / recurring | 0 / 0 / 1 | The 1 is a $1.00 test subscription. |

## Item 2 — "migrate what is recoverable" · NO-OP, PROVEN

Bucket 1 held two rows. Both were read back from Stripe through the same
mapping the reconciliation guard uses (`gifts.stripe_payment_id` → PaymentIntent
→ `amount_received`, per connected account):

| Gift | Org | PaymentIntent | Stored | Stripe `amount_received` | Delta |
|---|---|---|---:|---:|---:|
| `g_0c585e1d` | org_creo | `pi_3Tsm4k60K2lqE4aV1ulOSlBO` | $1.00 | $1.00 | **$0.00** |
| `g_76da4688` | org_creo | `pi_3U5Ugz60K2lqE4aV0s0wiOlU` | $1.00 | $1.00 | **$0.00** |

```
sampled 2 · matched 2 · DRIFTED 0 · unreadable 0
```

**No value-restoring migration was written, because there is no value to
restore.** This is not the BUILD-72 conclusion re-asserted — BUILD-72 reached
"nothing is recoverable" from the schema, by defining the affected set so that
nothing recoverable could be in it. This reaches it by asking Stripe.

## Item 3 — "list what is not recoverable" · THE LIST

7,569 rows, $11,821,940.00 nominal, upper-bound drift $7,493.31 (7,569 × $0.99,
an arithmetic ceiling and not a claim). By organization:

| Rows | Nominal | Organization |
|---:|---:|---|
| 5,430 | $3,321,005.00 | Women against Poverty `org_d3779a40` |
| 1,021 | $3,664,775.00 | Test1 `org_4d0ffd37` |
| 1,021 | $3,664,775.00 | atkinson `org_1403b0d9` |
| 68 | $470,950.00 | CREO Arts (Demo) `org_creo` |
| 25 | $699,900.00 | Salvation Army `org_7c22b06c` |
| 3 | $285.00 | Harbor Music School (Demo) `org_b6e8feee` |
| 1 | $250.00 | b36 receipt verify `org_78dea45b` |

**Every row is demo, test or seed data.** `Test1` and `atkinson` are
byte-identical — the same fixture loaded twice. Production has never imported a
real donor file, and has taken exactly two online charges, both $1.00.

**No donor-level list is produced, because there is no donor to name.** Had one
existed it would be here with its drift, per the brief's item 3, and nothing
would have been guessed at or silently rounded.

## Item 4 — "reissue nothing automatically" · NOTHING TO REISSUE

Bucket 3 is zero. No person holds a receipt, email or PDF whose figure
disagrees with the ledger by cents. There is no list to hand to Jonathan and no
communication to decide about.

## What DID change: the schema, and only its constraint

One migration ran, in `db.js`, and it cannot alter a stored figure.

```sql
ALTER TABLE <t> ALTER COLUMN <c> TYPE NUMERIC(12,2) USING ROUND(<c>::numeric, 2);
```

applied to `gifts.amount`, `gifts.cover_fee_amount`, `gifts.deductible_amount`,
`donors.total_giving`, `donors.last_gift_amount`, `pledges.amount`,
`fin_transactions.amount`, `recurring_subscriptions.amount`.

**Why it is safe on every existing row.** The Part 1 audit measured every one of
these columns: **not a single row carries a value with more than two decimal
places, because not a single row carries cents at all.** `ROUND(x, 2)` on a
whole-dollar value is that value. The rewrite is a no-op on data and a change
only to what the column will accept in future.

**Why it exists.** The earlier `INTEGER → NUMERIC` migration (the cover-fees
change) made cents *storable* but left the columns unconstrained: bare `NUMERIC`
accepts `$33.333` as readily as `$33.33`. Sub-cent noise is the one money error
no invariant in this codebase would catch, because every check reconciles to
2dp. `NUMERIC(12,2)` makes the database the last line of defence behind
`money.js` — if a future write path is ever added that skips the seam, Postgres
rounds it to the cent instead of storing something no one can reconcile.

Guarded on `numeric_scale IS DISTINCT FROM 2` so the table rewrite runs once,
not on every boot — the same guard pattern as the migration above it.

**Idempotent:** a second boot finds `numeric_scale = 2` and does nothing. Proven
by booting the scratch server twice against the same database.

## Proven on a copy first

Every change here was exercised against the scratch cluster at
`/tmp/steward-b73-pg` (`:5546/steward_loadtest`), seeded to 25,000 donors and
202,561 gifts, before any of it was committed. **Nothing in this build has been
run against the production database except the read-only audit**, which opened a
`READ ONLY` transaction, issued `SELECT`s and `ROLLBACK`ed.
