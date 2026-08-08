# BUILD-45 follow-up — gift-path concurrency: torn write in the edit→recalc→stamp sequence (2026-08-08)

CI on `main` was red on a flaky `concurrency2` assertion. Diagnosed to a **real
(rare) race** in `PUT /gifts/:id`, then the whole gift-write surface was
enumerated and the same-sequence single-gift routes were locked. This file is the
required write-up (kept regardless of outcome).

## The race (why the assertion flakes)

`concurrency2.test.js` scenario 1 fires two **parallel** `PUT /gifts/:id` on the
SAME gift — one sets `amount=700`, the other `amount=900` — then asserts the final
`gift.amount`, `donor.total_giving`, and the gift's `fin_transactions` stamp are
all equal to the winning amount (no torn write). It flaked `coherent:3/6` locally
(~1 in 8) and more reliably on CI's contended runner (red since `68bca5c`, the
commit that introduced the suite — NOT the D-1 change).

Root cause: `PUT /gifts/:id` did three unsynchronized writes per request —

1. `UPDATE gifts SET amount=…`
2. `recalcDonorSummary(donor)` — a **read-modify-write**: `SELECT SUM(amount)` then
   `UPDATE donors SET total_giving=…` (two statements, `server.js` ~1418)
3. `UPDATE fin_transactions SET amount=… WHERE gift_id=…` — a bare write

With two requests interleaving, the three "last writes" can come from different
requests, e.g. gift=900 (req B) / donor=900 (a recalc that read 900) / ledger=700
(req A's ledger write landed last) → **Cash on Hand permanently disagrees with the
gift record, with no mismatch queue to surface it.**

## P1 vs P0 — is a single user's double-tapped Save affected? → **P1, not P0.**

A double-tapped Save fires two `PUT /gifts/:id` carrying the **same** amount. Each
request sets `gift.amount=X` before its own recalc runs, so every interleave
converges to `gift=donor=ledger=X`. The torn state requires two **different**
target amounts in flight — two concurrent editors (or one user rapidly changing the
value and saving twice, which is not a double-tap). Unlike **F-3** (POST /gifts
double-tap → two *rows*, an idempotency-key gap), a PUT double-tap targets one
existing row and is idempotent on value. So: a rare two-writer **coherence** race
(P1), not single-user silent corruption (P0).

## The fix — BUILD-27 per-gift advisory lock

`withAdvisoryLock('gift:<id>', …)` (db.js, the same primitive the import and
webhook-donor dedup paths already use) wraps the whole edit→recalc→stamp trio so
the last writer wins all three atomically. No schema change; a session-level
`pg_advisory_lock(hashtext('gift:'+id))` on a dedicated pooled client, released in
`finally`. One key per gift, no nested advisory keys → no lock-ordering deadlock.

## Route enumeration — every gift-write → donor-recalc / ledger-stamp path

| Route (server.js) | donor update | ledger | on the torn recalc+stamp sequence? | protection now |
|---|---|---|---|---|
| **PUT /gifts/:id** (~3814) | `recalcDonorSummary` (read-modify-write) | bare `UPDATE` | **YES** (the failing test) | **LOCKED `gift:<id>`** ✅ |
| **DELETE /gifts/:id** (~3878) | `recalcDonorSummary` after the delete txn | `DELETE` stamp in txn | **YES** (recalc R-M-W) | **LOCKED `gift:<id>`** ✅ |
| **charge.refunded — full** (~550) | `recalcDonorSummary` after the txn | `DELETE` stamp in txn | **YES** | **LOCKED `gift:<id>`** ✅ |
| **charge.refunded — partial** (~577) | `recalcDonorSummary` after the txn | `UPDATE` stamp in txn | **YES** | **LOCKED `gift:<id>`** ✅ |
| POST /donors/:id/gifts (~3638) | **atomic** `total_giving = total_giving + ?` | `INSERT … ON CONFLICT (gift_id) DO NOTHING` | NO — atomic increment + per-gift-idempotent stamp; no R-M-W | **deferred** — coherent by construction; its only concurrency gap is F-3 (double-tap → two rows), an idempotency-key issue tracked separately, out of scope |
| pledge payment | = POST /donors/:id/gifts | same | NO | **deferred** — same path as POST /gifts |
| POST /donors/merge (~3579) | `recalcDonorSummary(primary)` after a txn | n/a (reassigns gifts, no amount edit) | partial (recalc R-M-W, but no amount change) | **deferred** — cross-donor/many-gift op; a single `gift:<id>` key doesn't map (the correct key is `donor:<primary>`); admin-only + rare; needs its own concurrency test before locking |
| /gifts/import-history (~4470) | `recalcDonorSummaryBatch` (single set-based statement) | `INSERT` stamps in txn | NO — batch recalc is atomic per statement | **deferred** — bulk op; concurrent same-org imports are rare; extend the existing `import:<org>` lock (which already covers /donors/import-combined) to this route in a dedicated import-concurrency pass |
| /donors/import-combined (~3060) | `recalcDonorSummaryBatch` | `INSERT` stamps | NO (batch) | already inside `withAdvisoryLock('import:<org>')` ✅ |
| PATCH /events/:id/attendees (auto-gift, ~14531) | new gift | `INSERT` stamp | NO — new-gift path, not edit-recalc | **deferred** — F-3-class idempotency only (marking one attendee attended twice); not the torn sequence |
| Stripe payment_intent.succeeded (~337) | new gift | `INSERT … ON CONFLICT (gift_id) DO NOTHING` | NO | already `withAdvisoryLock('donor:…')` + `uq_gifts_stripe_pi` idempotency ✅ |
| sample-data seed (~2159) | — | `INSERT … ON CONFLICT DO NOTHING` | NO | one-shot seed, not concurrent ✅ |

**Locked now:** PUT /gifts/:id, DELETE /gifts/:id, charge.refunded (full + partial)
— every single-gift route on the read-modify-write recalc + bare-stamp sequence.

**Deferred (with reasons above):** POST /gifts + pledge payment (atomic increment,
not the sequence; F-3 is separate), donor-merge (cross-gift; needs a `donor:` lock +
own test), import-history (bulk; extend `import:` lock in a dedicated pass),
event-attendee auto-gift (new-gift/F-3-class). None of the deferred routes is on the
unsynchronized R-M-W-plus-bare-stamp path the test exposes.

## Verification gate (per the follow-up brief)

- `concurrency2` green **20 consecutive runs** (not once).
- Full suite green on **two cold-start runs** (fresh server boot, not a warm/re-phased-timer run).
- If not deterministically green in a reasonable time box → **revert**, log as a
  finding, proceed to Phase 2. Do not chase. A red CI badge is a smaller problem
  than a bad lock in the gift path; prod is already verified good.

## Results (2026-08-08)

- **`concurrency2`: 20/20 consecutive runs green** (14/14 each) — was ~1-in-8 flaky
  before the lock; deterministic after. The `coherent:N/6` torn-write assertion now
  always reads 6/6.
- **Full suite: two independent cold-start runs, 65/65 each** (fresh server boot
  before each; `run-all.sh` exit 0 both times) — no regression on any locked route
  (refund paths are exercised by `attribution-completeness` / `consistency-e2e`,
  DELETE by `donor-merge` / `report-truth`).
- Outcome: **verified — pushed.** Locks landed on PUT /gifts/:id, DELETE /gifts/:id,
  charge.refunded (full + partial). Deferred routes (POST /gifts, merge,
  import-history, event auto-gift) left with the reasons in the table above, as a
  follow-up finding for a dedicated pass.
