# SCALE-6 · `GET /donors` stops timing out under load (Nov 20, 2026)

## Part 1: where a slow `/donors` spent its time

SCALE-5 left this open: the nightly load had `/donors` at a 10 s max with a few 5xx, and the
laptop never reproduced it. The reason the laptop never saw it: Homebrew's Postgres is built
without LLVM (`pg_jit_available()` is false), and CI's `postgres:16`, staging and prod have it.

A throwaway branch ran the nightly with every statement over 150 ms logged, then EXPLAIN
ANALYZE'd the slowest with JIT on and off on the same runner (run 44756461721):

- `/donors/counts`: 2,691 ms with JIT, 457 ms without (2,111 ms of it compiling).
- a status-filtered Donors page: 974 ms and 389 ms; its count 549 ms and 353 ms.
- a report aggregate: 4,430 ms and 480 ms.

Postgres compiles a statement whose estimated cost passes 100,000, and inlines and optimises
past 500,000. Two things pushed the Donors reads past them:

1. **A status filter read each giver's giving unit per row.** `donorStatus.statusSql` (every
   status filter: a level, a lifecycle, Lapsing, Retained) asked NUMBERS-7's linked people's
   last gift (with its nested gifts subquery), the pledges that hold, the stored rhythm and an
   overdue pledge once per giver: estimated 1.7 million on 25,000 people. COUNTS-1 had built
   the set-wise unit (`lapse.unitSetsSql`) for `/donors/counts`; `statusSql` never used it.
   Now it joins the unit, the on-time date (`lapse.ON_TIME_JOINED`) and an overdue pledge
   (`lapse.overdueSetSql`) once per read: 94k. `/donors/counts` read the rhythm per giver too
   (785k); now joined (54k). And `tagCondition` materialises only the matching ids, so a level
   filter no longer computes the lifecycle's aggregates.
2. **JIT itself.** Steward's reads are pages, counts and one org's aggregates; compiling never
   paid. REPORTS-SPEED-2 turned it off for one report, FLOWS-16 for the set-wise pool. Now the
   main pool starts every connection with `jit=off`.

Measured and left alone: the default Lifetime sort is still one index probe per person
(TRUTH-3's live Lifetime). On 25,000 people the probes take 186 ms and one grouped read of the
org's gifts 259 ms.

The answers are unchanged: main's `statusSql` and the new one gave the same 81,025 rows and the
same people for every tag on the ten-orgs fixture with links and pledges added, and
`tests/scale6.test.js` holds every giver's org-wide row to the one-person form, byte for byte.
