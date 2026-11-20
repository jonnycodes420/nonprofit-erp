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

## Part 2: no long waits for a connection, and the first screen after a save

**Item 2.** A request used to wait for a pool connection as long as its statement limit (10 s),
so a busy minute showed as a frozen screen and then "This took too long". Now a wait on the
pool itself ends at 3 s with a 503 "Steward is busy, try again.", and the browser reads it again
once, a second later. Writes are never resent: a busy answer can arrive after some of a write's
statements ran, and a gift must not be recorded twice. Work outside a request leaves the web
process's last two connections to web reads. The first version of the busy timer had a TDZ
bug: `checkout()` declares its own `const busy` further down, which shadowed the new function,
and the suite's first run threw on it. The TDZ scan misses a shadow like that.

**Item 3 (W-1112-Volunteers-01X, nine nights).** Earlier rounds fixed the first screen after a
save one panel at a time. This round counted: of 925 writes in `client/src`, 408 announced
nothing (`kindsOfWrite` said "other"), so no screen re-read after them. Most are /ops, Settings
and editors, but some were the fleet's: marking a Home drift row done changes a task (its next
step is a task) and announced nothing, so the Tasks badge waited for a reload. Restoring a
deleted record, assigning owners from Home, relationships, gift attribution, applying a
journey and Fundraising's campaigns were the same. Each now has a rule. The rest are a
baseline that only shrinks, and a new unannounced write fails the build.

One stale screen was not an announcement problem. Donors → Team sums the app's whole-org list
of people, which re-read only when people were added or removed. A gift recorded from Donors →
Record a gift moved the owner's total only after a reload. Reproduced with real clicks on a
local production build, the same server and the same clicks with main's client and this one:
main stayed at $10,996,865.77 until a reload showed $10,997,865.77; this branch moved
$10,995,865.77 → $10,996,865.77 at once. Now the people a write names are re-read by id
(`/donors/lookup`) into that list, instead of reading the whole org again.
